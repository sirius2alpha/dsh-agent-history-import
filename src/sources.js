/**
 * Discovery and parsing of conversation histories written by other local agents.
 *
 * Three sources are supported, each with its own on-disk layout:
 *
 * - Codex (`~/.codex/sessions`): rollout JSONL records. Conversation content is
 *   in `response_item` records; `event_msg` carries UI events and is ignored.
 * - Pi (`~/.pi/agent/sessions`): one JSONL file per session. `message` records
 *   form a parent-linked tree; the branch ending at the last message is read.
 * - Claude Code (`~/.claude/projects`): one JSONL file per session. `user` and
 *   `assistant` records carry Anthropic content blocks; sidechains are skipped.
 *
 * Every parser produces the same normalized transcript:
 *
 *   { role: 'user', text, time }
 *   { role: 'assistant', text?, reasoning?, toolCalls?, time }
 *   { role: 'tool', callId, toolName, text, isError?, time }
 */

import { constants as fsConstants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'

/** Largest number of files one directory walk may inspect. */
const MAX_FILES = 20000
/** Largest directory depth one walk may descend. */
const MAX_DEPTH = 10
/** Bytes read from a file to derive list metadata before a full parse. */
const META_HEAD_BYTES = 262144

/** Source identifiers accepted by the routes. */
export const SOURCE_IDS = ['codex', 'pi', 'claude']

/** Localized display labels are supplied by the Client; these are diagnostics. */
const SOURCE_LABELS = { codex: 'Codex', pi: 'Pi', claude: 'Claude Code' }

/**
 * Source layouts resolved against the current user's home directory.
 * @param {string} [home] - home directory override, for tests.
 * @returns {Record<string, { label: string, roots: string[] }>}
 */
export function sourceLayouts(home = homedir()) {
  return {
    codex: { label: SOURCE_LABELS.codex, roots: [join(home, '.codex', 'sessions'), join(home, '.codex', 'archived_sessions')] },
    pi: { label: SOURCE_LABELS.pi, roots: [join(home, '.pi', 'agent', 'sessions')] },
    claude: { label: SOURCE_LABELS.claude, roots: [join(home, '.claude', 'projects')] },
  }
}

/** @typedef {'codex' | 'pi' | 'claude'} SourceId */

/**
 * Report which sources exist on this computer.
 * @param {string} [home] - home directory override.
 * @returns {Promise<Array<{ id: SourceId, label: string, available: boolean, roots: string[] }>>}
 */
export async function listSources(home = homedir()) {
  const layouts = sourceLayouts(home)
  const sources = []
  for (const id of SOURCE_IDS) {
    const layout = layouts[id]
    let available = false
    for (const root of layout.roots) {
      try {
        available ||= (await stat(root)).isDirectory()
      } catch (_missing) {
        // A missing root is simply unavailable.
      }
    }
    sources.push({ id, label: layout.label, available, roots: layout.roots })
  }
  return sources
}

/**
 * List recent sessions of one source, most recently modified first.
 * @param {object} options
 * @param {SourceId} options.source - source to scan.
 * @param {string} [options.home] - home directory override.
 * @param {number} [options.limit] - most entries to return.
 * @returns {Promise<{ source: SourceId, sessions: Array<object>, scanned: number, truncated: boolean }>}
 */
export async function listSessions({ source, home = homedir(), limit = 100 }) {
  const layout = sourceLayouts(home)[source]
  if (layout === undefined) throw new ImportError('unknown-source', `unknown source ${JSON.stringify(source)}`)
  /** @type {Array<{ file: string, mtimeMs: number, size: number }>} */
  const files = []
  let scanned = 0
  for (const root of layout.roots) {
    const found = await walk(root, source)
    scanned += found.scanned
    for (const entry of found.files) files.push(entry)
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const chosen = files.slice(0, Math.max(1, limit))
  const sessions = []
  for (const entry of chosen) {
    const meta = await readMetadata(source, entry.file)
    sessions.push({
      source,
      file: entry.file,
      title: meta.title ?? fallbackTitle(entry.file),
      cwd: meta.cwd ?? null,
      createdAt: meta.createdAt ?? entry.mtimeMs,
      updatedAt: entry.mtimeMs,
      bytes: entry.size,
    })
  }
  return { source, sessions, scanned, truncated: files.length > chosen.length }
}

/**
 * Read and parse one complete session.
 * @param {object} options
 * @param {SourceId} options.source - source that owns the file.
 * @param {string} options.file - absolute session file path.
 * @param {string} [options.home] - home directory override.
 * @param {number} [options.maxBytes] - largest accepted file size.
 * @returns {Promise<object>} the normalized transcript.
 */
export async function readTranscript({ source, file, home = homedir(), maxBytes = 48 * 1024 * 1024 }) {
  const layout = sourceLayouts(home)[source]
  if (layout === undefined) throw new ImportError('unknown-source', `unknown source ${JSON.stringify(source)}`)
  await assertWithinRoots(file, layout.roots)
  const info = await stat(file)
  if (!info.isFile()) throw new ImportError('not-a-file', `${file} is not a regular file`)
  if (info.size > maxBytes) {
    throw new ImportError('too-large', `the session file is ${info.size} bytes, above the ${maxBytes}-byte limit`)
  }
  const text = await readFileText(file, maxBytes)
  const transcript = source === 'codex'
    ? parseCodex(text, file)
    : source === 'pi' ? parsePi(text, file) : parseClaude(text, file)
  transcript.source = source
  transcript.file = file
  return transcript
}

/**
 * Refuse a path outside the source roots, so the route cannot read arbitrary files.
 * @param {string} file - candidate path.
 * @param {string[]} roots - allowed roots.
 */
async function assertWithinRoots(file, roots) {
  const candidate = await realpath(resolve(file))
  let inside = false
  for (const root of roots) {
    let real
    try {
      real = await realpath(root)
    } catch (_missing) {
      continue
    }
    if (candidate === real || candidate.startsWith(real + sep)) inside = true
  }
  if (!inside) throw new ImportError('outside-root', `${file} is not inside a supported history directory`)
}

/**
 * Walk one root, returning regular `.jsonl` files without following symlinks.
 * @param {string} root - directory to walk.
 * @param {SourceId} source - source whose file naming applies.
 * @returns {Promise<{ files: Array<{ file: string, mtimeMs: number, size: number }>, scanned: number }>}
 */
async function walk(root, source) {
  const files = []
  let scanned = 0
  const queue = [{ path: root, depth: 0 }]
  while (queue.length > 0 && scanned < MAX_FILES) {
    const { path, depth } = queue.shift()
    let directory
    try {
      directory = await opendir(path)
    } catch (_missing) {
      continue
    }
    for await (const entry of directory) {
      if (scanned >= MAX_FILES) break
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) queue.push({ path: child, depth: depth + 1 })
        continue
      }
      if (!entry.isFile() || extname(entry.name) !== '.jsonl') continue
      scanned++
      const info = await stat(child)
      if (source === 'codex' && !entry.name.startsWith('rollout-')) continue
      files.push({ file: child, mtimeMs: info.mtimeMs, size: info.size })
    }
  }
  return { files, scanned }
}

/**
 * Read a bounded head of one file and derive its title, working directory, and
 * creation time without parsing the whole log.
 * @param {SourceId} source - source format.
 * @param {string} file - session file.
 * @returns {Promise<{ title: string | null, cwd: string | null, createdAt: number | null }>}
 */
async function readMetadata(source, file) {
  const text = await readFileText(file, META_HEAD_BYTES)
  if (source === 'codex') return metaCodex(text)
  if (source === 'pi') return metaPi(text)
  return metaClaude(text)
}

function metaCodex(text) {
  let cwd = null
  let createdAt = null
  let title = null
  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    if (record.type === 'session_meta') {
      cwd = stringOrNull(record.payload?.cwd)
      createdAt = timeOf(record.payload?.timestamp) ?? timeOf(record.timestamp)
    } else if (record.type === 'response_item' && record.payload?.type === 'message' && record.payload.role === 'user') {
      if (!isRealCodexUser(record.payload)) continue
      title = titleOf(textOfContent(record.payload.content))
      if (title !== null) break
    }
  }
  return { title, cwd, createdAt }
}

function metaPi(text) {
  let cwd = null
  let createdAt = null
  let title = null
  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    if (record.type === 'session') {
      cwd = stringOrNull(record.cwd)
      createdAt = timeOf(record.timestamp)
    } else if (record.type === 'message' && record.message?.role === 'user') {
      title = titleOf(textOfPiContent(record.message.content))
      if (title !== null) break
    }
  }
  return { title, cwd, createdAt }
}

function metaClaude(text) {
  let cwd = null
  let createdAt = null
  let title = null
  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    if (cwd === null) cwd = stringOrNull(record.cwd)
    if (createdAt === null) createdAt = timeOf(record.timestamp)
    if ((record.type === 'user' || record.type === 'assistant') && record.isSidechain !== true) {
      if (record.type === 'user') {
        title = titleOf(textOfClaudeContent(record.message?.content))
        if (title !== null) break
      }
    }
  }
  return { title, cwd, createdAt }
}

/**
 * Parse one Codex rollout.
 * @param {string} text - complete file text.
 * @param {string} file - path, for error messages.
 * @returns {object} normalized transcript.
 */
export function parseCodex(text, file = '') {
  const items = []
  let cwd = null
  let sessionId = null
  let createdAt = null
  const calls = new Map()
  let lastTime = 0

  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    const time = timeOf(record.timestamp) ?? createdAt ?? Date.now()
    lastTime = Math.max(lastTime, time)
    if (record.type === 'session_meta') {
      cwd = stringOrNull(record.payload?.cwd) ?? cwd
      sessionId = stringOrNull(record.payload?.id) ?? stringOrNull(record.payload?.session_id) ?? sessionId
      createdAt ??= timeOf(record.payload?.timestamp) ?? time
      continue
    }
    if (record.type !== 'response_item') continue
    const payload = record.payload
    if (payload === null || typeof payload !== 'object') continue
    switch (payload.type) {
      case 'message': {
        const content = textOfContent(payload.content)
        if (payload.role === 'user') {
          if (!isRealCodexUser(payload)) break
          if (content.trim().length > 0) items.push({ role: 'user', text: content, time: lastTime })
        } else if (payload.role === 'assistant') {
          if (content.trim().length > 0) items.push({ role: 'assistant', text: content, time: lastTime })
        }
        break
      }
      case 'custom_tool_call':
      case 'function_call': {
        const id = stringOrNull(payload.call_id) ?? stringOrNull(payload.id)
        if (id === null) break
        const name = stringOrNull(payload.name) ?? 'tool'
        const raw = payload.type === 'custom_tool_call' ? payload.input : payload.arguments
        const args = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {})
        calls.set(id, { id, name, arguments: args })
        items.push({ role: 'assistant', toolCalls: [{ id, name, arguments: args }], time: lastTime })
        break
      }
      case 'custom_tool_call_output':
      case 'function_call_output': {
        const id = stringOrNull(payload.call_id)
        if (id === null) break
        const output = payload.output
        const body = Array.isArray(output)
          ? output.map(part => typeof part === 'string' ? part : stringOrNull(part?.text) ?? '').join('\n')
          : typeof output === 'string' ? output : JSON.stringify(output ?? '')
        const call = calls.get(id)
        items.push({ role: 'tool', callId: id, toolName: call?.name ?? 'tool', text: body, isError: false, time: lastTime })
        break
      }
      default:
        // Reasoning is encrypted; world_state, token records, and UI events are not conversation.
        break
    }
  }
  return finishTranscript({ source: 'codex', file, sessionId, cwd, createdAt, items })
}

/**
 * Parse one Pi session, following the parent chain that ends at the last message.
 * @param {string} text - complete file text.
 * @param {string} file - path, for error messages.
 * @returns {object} normalized transcript.
 */
export function parsePi(text, file = '') {
  const records = []
  let cwd = null
  let sessionId = null
  let createdAt = null
  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    if (record.type === 'session') {
      cwd = stringOrNull(record.cwd) ?? cwd
      sessionId = stringOrNull(record.id) ?? sessionId
      createdAt ??= timeOf(record.timestamp)
      continue
    }
    if (record.type === 'message' && record.message !== null && typeof record.message === 'object') records.push(record)
  }
  const branch = selectPiBranch(records)
  const items = []
  let lastTime = createdAt ?? 0
  for (const record of branch) {
    const message = record.message
    const time = Math.max(lastTime, timeOf(message.timestamp) ?? timeOf(record.timestamp) ?? lastTime)
    lastTime = time
    if (message.role === 'user') {
      const body = textOfPiContent(message.content)
      if (body.trim().length > 0) items.push({ role: 'user', text: body, time })
    } else if (message.role === 'assistant') {
      const parsed = parsePiAssistant(message.content)
      if (parsed.text !== '' || parsed.reasoning !== '' || parsed.toolCalls.length > 0) {
        items.push({ role: 'assistant', ...parsed, time })
      }
    } else if (message.role === 'toolResult') {
      items.push({
        role: 'tool',
        callId: stringOrNull(message.toolCallId) ?? '',
        toolName: stringOrNull(message.toolName) ?? 'tool',
        text: textOfPiContent(message.content),
        isError: message.isError === true,
        time,
      })
    }
  }
  return finishTranscript({ source: 'pi', file, sessionId, cwd, createdAt, items })
}

/**
 * Follow `parentId` from the last message to the root. A malformed chain falls
 * back to file order, which keeps the import useful for partially written logs.
 * @param {Array<object>} records - message records in file order.
 * @returns {Array<object>} the selected branch in chronological order.
 */
function selectPiBranch(records) {
  if (records.length === 0) return records
  const byId = new Map()
  for (const record of records) {
    const id = stringOrNull(record.id)
    if (id !== null && !byId.has(id)) byId.set(id, record)
  }
  const chain = []
  const seen = new Set()
  let current = records[records.length - 1]
  while (current !== undefined) {
    const id = stringOrNull(current.id)
    if (id !== null) {
      if (seen.has(id)) return records
      seen.add(id)
    }
    chain.push(current)
    const parentId = stringOrNull(current.parentId)
    if (parentId === null) break
    current = byId.get(parentId)
    if (current === undefined) return records
  }
  return chain.reverse()
}

function parsePiAssistant(content) {
  let text = ''
  let reasoning = ''
  const toolCalls = []
  for (const block of Array.isArray(content) ? content : []) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
    else if (block.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
    else if (block.type === 'toolCall') {
      const id = stringOrNull(block.id) ?? `tool-${toolCalls.length}`
      toolCalls.push({ id, name: stringOrNull(block.name) ?? 'tool', arguments: JSON.stringify(block.arguments ?? {}) })
    }
  }
  return { text, reasoning, toolCalls }
}

/**
 * Parse one Claude Code session.
 * @param {string} text - complete file text.
 * @param {string} file - path, for error messages.
 * @returns {object} normalized transcript.
 */
export function parseClaude(text, file = '') {
  const items = []
  let cwd = null
  let sessionId = null
  let createdAt = null
  let lastTime = 0
  for (const line of linesOf(text)) {
    const record = parseJson(line)
    if (record === null) continue
    if (cwd === null) cwd = stringOrNull(record.cwd)
    if (sessionId === null) sessionId = stringOrNull(record.sessionId)
    const time = Math.max(lastTime, timeOf(record.timestamp) ?? lastTime)
    lastTime = time
    createdAt ??= timeOf(record.timestamp)
    if (record.isSidechain === true) continue
    if (record.isMeta === true) continue
    if (record.type !== 'user' && record.type !== 'assistant') continue
    const message = record.message
    if (message === null || typeof message !== 'object') continue
    const blocks = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content) ? message.content : []
    if (record.type === 'user') {
      const textParts = []
      const results = []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text)
        else if (block.type === 'tool_result') {
          results.push({
            role: 'tool',
            callId: stringOrNull(block.tool_use_id) ?? '',
            toolName: 'tool',
            text: textOfClaudeContent(block.content),
            isError: block.is_error === true,
            time,
          })
        }
      }
      for (const result of results) items.push(result)
      const body = textParts.join('\n')
      if (body.trim().length > 0) items.push({ role: 'user', text: body, time })
    } else {
      let textBody = ''
      let reasoning = ''
      const toolCalls = []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') textBody += block.text
        else if (block.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: stringOrNull(block.id) ?? `tool-${toolCalls.length}`,
            name: stringOrNull(block.name) ?? 'tool',
            arguments: JSON.stringify(block.input ?? {}),
          })
        }
      }
      if (textBody.length > 0 || reasoning.length > 0 || toolCalls.length > 0) {
        items.push({
          role: 'assistant',
          ...textBody.length === 0 ? {} : { text: textBody },
          ...reasoning.length === 0 ? {} : { reasoning },
          ...toolCalls.length === 0 ? {} : { toolCalls },
          time,
        })
      }
    }
  }
  return finishTranscript({ source: 'claude', file, sessionId, cwd, createdAt, items })
}

/**
 * Fill in the transcript title and counters from its items.
 * @param {object} transcript - partially built transcript.
 * @returns {object} the same transcript, completed.
 */
function finishTranscript(transcript) {
  const items = transcript.items
  const firstUser = items.find(item => item.role === 'user' && typeof item.text === 'string')
  const title = titleOf(firstUser?.text) ?? null
  return {
    ...transcript,
    title,
    createdAt: transcript.createdAt ?? items[0]?.time ?? Date.now(),
    stats: {
      userMessages: items.filter(item => item.role === 'user').length,
      assistantMessages: items.filter(item => item.role === 'assistant').length,
      toolResults: items.filter(item => item.role === 'tool').length,
    },
  }
}

/**
 * Whether one Codex user message is a human prompt rather than injected context.
 * `content_item_kinds` distinguishes them when present; otherwise the leading
 * XML wrapper identifies the environment and instruction records.
 * @param {object} payload - a `response_item` message payload.
 * @returns {boolean}
 */
function isRealCodexUser(payload) {
  const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds
  if (Array.isArray(kinds) && kinds.length > 0) {
    // Only a record carrying `user.text` is a human prompt. Codex also tags
    // instruction files and environment context with the user role.
    if (!kinds.includes('user.text')) return false
    if (kinds.some(kind => typeof kind === 'string' && /instructions|environment_context|additional_content/u.test(kind))) return false
    return true
  }
  const text = textOfContent(payload.content).trimStart()
  if (text.startsWith('<environment_context>')) return false
  if (text.startsWith('<user_instructions>')) return false
  if (text.startsWith('<multi_agent_')) return false
  if (text.startsWith('<codex_apps_client_time_context>')) return false
  if (text.startsWith('# AGENTS.md instructions for ')) return false
  return text.length > 0
}

/**
 * Concatenate text blocks of a Codex or Anthropic-shaped content array.
 * @param {unknown} content - content blocks.
 * @returns {string}
 */
function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function textOfPiContent(content) {
  return textOfContent(content)
}

function textOfClaudeContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => block !== null && typeof block === 'object' && typeof block.text === 'string' ? block.text : '').join('\n')
}

/**
 * Derive a short session title from a user message.
 * @param {string | undefined} text - first user text.
 * @returns {string | null}
 */
function titleOf(text) {
  if (typeof text !== 'string') return null
  const cleaned = cleanUserText(text)
  if (cleaned.length === 0) return null
  // Codex prefixes a pasted-file block with metadata; the human request follows
  // the `## My request:` marker.
  const requestIndex = cleaned.indexOf('## My request:')
  const candidate = requestIndex >= 0 ? cleaned.slice(requestIndex + '## My request:'.length) : cleaned
  const firstLine = candidate.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? ''
  const condensed = firstLine.replace(/\s+/gu, ' ').trim()
  if (condensed.length === 0) return null
  return condensed.length > 120 ? `${condensed.slice(0, 117)}...` : condensed
}

/**
 * Remove the IDE selection and system-reminder wrappers Claude Code prepends to
 * the first human prompt, keeping the sentence the user actually wrote.
 * @param {string} text - raw user text.
 * @returns {string}
 */
function cleanUserText(text) {
  return text
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/gu, ' ')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/gu, ' ')
    .replace(/<ide_diagnostics>[\s\S]*?<\/ide_diagnostics>/gu, ' ')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, ' ')
    .replace(/<command-name>[\s\S]*?<\/command-name>/gu, ' ')
    .trim()
}

function fallbackTitle(file) {
  return file.slice(file.lastIndexOf(sep) + 1).replace(/\.jsonl$/u, '')
}

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function* linesOf(text) {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) yield line
  }
}

function parseJson(line) {
  try {
    return JSON.parse(line)
  } catch (_invalidJson) {
    return null
  }
}

/**
 * Read a text file up to a byte limit, dropping a possibly truncated tail line.
 * @param {string} file - path to read.
 * @param {number} limit - maximum bytes.
 * @returns {Promise<string>}
 */
async function readFileText(file, limit) {
  const handle = await open(file, fsConstants.O_RDONLY)
  try {
    const buffer = Buffer.alloc(Math.min(limit, (await handle.stat()).size))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    // A truncated multi-byte character becomes U+FFFD; replacing it with an empty
    // string keeps JSON parsing of complete lines unaffected.
    text = text.replace(/\uFFFD+$/u, '')
    if (bytesRead >= limit) {
      const lastBreak = text.lastIndexOf('\n')
      if (lastBreak >= 0) text = text.slice(0, lastBreak)
    }
    return text
  } finally {
    await handle.close()
  }
}

/** A failure carrying a stable reason the route and dialog can translate. */
export class ImportError extends Error {
  /**
   * @param {string} reason - stable failure category.
   * @param {string} message - diagnostic in English.
   * @param {{ cause?: unknown }} [options] - original failure.
   */
  constructor(reason, message, options) {
    super(message, options)
    this.name = 'ImportError'
    this.reason = reason
  }
}
