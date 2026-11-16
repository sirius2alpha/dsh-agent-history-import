/**
 * Model-written summarization of an imported transcript.
 *
 * Long transcripts are split on paragraph boundaries. Each chunk is summarized
 * into a detailed partial note, then the partial notes are reduced until one
 * handover summary remains. Every call goes through the mounted `llm` service,
 * so the user's configured default provider and model are used unless the
 * plugin config names an explicit route.
 */

import { ImportError } from './transcript.js'

/** Default characters of transcript sent to one model call. */
const DEFAULT_CHUNK_CHARS = 40000

/** Largest transcript text the summarizer accepts before truncating. */
const MAX_TRANSCRIPT_CHARS = 1200000

const PART_PROMPT = `You are summarizing part {part} of {total} of a conversation transcript from another coding agent. The transcript is the only source of truth.

Extract, in detail and without inventing anything:
- the user's goals, requirements, and constraints;
- work already performed: exact file paths, commands, edits, and their results;
- findings, decisions, and rejected alternatives with reasons;
- errors, failures, and whether they were resolved;
- repository, branch, commit, version, host, and environment facts;
- remaining tasks and the next concrete steps.

Preserve exact identifiers, paths, commands, versions, URLs, numbers, and short code snippets. If something is uncertain or missing, say so. Write in the language used by the user. Use Markdown headings and bullets. Do not use tools and do not address the user.

Transcript part {part}/{total}:
---
{text}
---`

const MERGE_PROMPT = `You are merging partial summaries of one conversation from another coding agent into a single detailed handover summary. The result will be the starting context of a new conversation.

Produce one coherent summary with these sections, omitting a section only when the transcript truly has nothing for it:
1. Goal and current status
2. User requirements and constraints
3. Work performed (files, commands, results)
4. Key findings and decisions
5. Errors and how they were handled
6. Repository and environment state
7. Remaining tasks and next steps

Preserve exact identifiers, paths, commands, versions, URLs, numbers, and short code snippets. Do not invent facts. If the partial summaries conflict, prefer the later one and note the difference. Write in the language used by the user. Use Markdown headings and bullets. Do not address the user.

Partial summaries:
---
{text}
---`

const SINGLE_PROMPT = `You are writing a detailed handover summary of a conversation from another coding agent. The result will be the starting context of a new conversation, so it must let another agent continue the work without the original transcript.

Produce one coherent summary with these sections, omitting a section only when the transcript truly has nothing for it:
1. Goal and current status
2. User requirements and constraints
3. Work performed (files, commands, results)
4. Key findings and decisions
5. Errors and how they were handled
6. Repository and environment state
7. Remaining tasks and next steps

Preserve exact identifiers, paths, commands, versions, URLs, numbers, and short code snippets. Do not invent facts. If something is uncertain, say so. Write in the language used by the user. Use Markdown headings and bullets. Do not use tools and do not address the user.

Conversation transcript:
---
{text}
---`

/**
 * Summarize transcript text with the mounted LLM service.
 * @param {object} options
 * @param {{ stream: (options: object) => AsyncIterable<object> }} options.llm - the Host LLM service.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} options.selection - model route.
 * @param {string} options.transcript - rendered transcript text.
 * @param {object} [options.config] - summarizer limits.
 * @param {AbortSignal} options.signal - cancellation.
 * @param {(phase: string, done: number, total: number) => void} [options.onProgress] - progress callback.
 * @returns {Promise<string>} the detailed summary.
 */
export async function summarizeTranscript({ llm, selection, transcript, config = {}, signal, onProgress = () => {} }) {
  if (typeof llm?.stream !== 'function') {
    throw new ImportError('no-model', 'summary mode needs a mounted LLM service')
  }
  if (typeof selection?.provider !== 'string' || typeof selection?.model !== 'string' || selection.provider === '' || selection.model === '') {
    throw new ImportError('no-model', 'summary mode needs a configured default model or a configured summary provider and model')
  }
  const chunkChars = config.summaryChunkChars ?? DEFAULT_CHUNK_CHARS
  const maxTokens = config.summaryMaxTokens ?? 8000
  const limited = limitText(transcript, MAX_TRANSCRIPT_CHARS)
  const text = limited.text
  const truncated = limited.truncated
  const chunks = chunkText(text, chunkChars)
  const generate = (prompt) => generateText({ llm, selection, prompt, maxTokens, signal })

  if (chunks.length <= 1) {
    onProgress('summarizing', 1, 1)
    return { summary: await generate(SINGLE_PROMPT.replace('{text}', text)), truncated }
  }

  let partials = []
  for (const [index, chunk] of chunks.entries()) {
    onProgress('summarizing', index + 1, chunks.length)
    partials.push(await generate(PART_PROMPT
      .replaceAll('{part}', String(index + 1))
      .replaceAll('{total}', String(chunks.length))
      .replace('{text}', chunk)))
  }
  // Reduce groups of partial notes until one remains, so the merge prompt never
  // outgrows the model window. Four notes per pass guarantees progress.
  while (partials.length > 1) {
    const next = []
    for (let start = 0; start < partials.length; start += 4) {
      const group = partials.slice(start, start + 4).join('\n\n---\n\n')
      next.push(await generate(MERGE_PROMPT.replace('{text}', group)))
    }
    partials = next
    onProgress('summarizing', 0, 1)
    // A model that returns no text on a merge pass would otherwise loop forever.
    if (partials.some(partial => partial.trim().length === 0)) {
      throw new ImportError('summary-empty', 'the summary model returned an empty merge result')
    }
  }
  const summary = partials[0]?.trim() ?? ''
  if (summary.length === 0) throw new ImportError('summary-empty', 'the summary model returned no text')
  return { summary, truncated }
}

/**
 * Stream one prompt and return its visible text.
 * @param {object} options
 * @param {object} options.llm - LLM service.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} options.selection - route.
 * @param {string} options.prompt - prompt text.
 * @param {number} options.maxTokens - output cap.
 * @param {AbortSignal} options.signal - cancellation.
 * @returns {Promise<string>}
 */
async function generateText({ llm, selection, prompt, maxTokens, signal }) {
  let text = ''
  const request = {
    provider: selection.provider,
    model: selection.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens,
    signal,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
  }
  try {
    for await (const chunk of llm.stream(request)) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error') {
          throw new ImportError('summary-failed', chunk.reason.failure?.message ?? 'the summary model failed')
        }
        if (chunk.reason.kind === 'aborted') {
          if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
          throw new ImportError('summary-failed', chunk.reason.failure?.message ?? 'the summary request was aborted')
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof ImportError) throw error
    throw new ImportError('summary-failed', error instanceof Error ? error.message : String(error), { cause: error })
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new ImportError('summary-empty', 'the summary model returned no text')
  return trimmed
}

/**
 * Split text on paragraph boundaries near a character budget.
 * @param {string} text - source text.
 * @param {number} budget - target characters per chunk.
 * @returns {string[]}
 */
export function chunkText(text, budget) {
  const paragraphs = String(text).split(/\n{2,}/u)
  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > budget) {
      if (current.length > 0) {
        chunks.push(current)
        current = ''
      }
      for (let start = 0; start < paragraph.length; start += budget) {
        chunks.push(paragraph.slice(start, start + budget))
      }
      continue
    }
    if (current.length > 0 && current.length + paragraph.length + 2 > budget) {
      chunks.push(current)
      current = ''
    }
    current = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`
  }
  if (current.trim().length > 0) chunks.push(current)
  return chunks.length === 0 ? [''] : chunks
}

function limitText(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return { text: value, truncated: false }
  return { text: `${value.slice(0, max)}\n\n[transcript truncated at ${max} characters]`, truncated: true }
}
