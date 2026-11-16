/**
 * Import orchestration: read one source session, convert or summarize it, then
 * write a stored DSH Session into a chosen Workspace.
 *
 * The written Session is seed-validated with `Session.create` before anything
 * reaches durable storage, so a malformed conversion fails before a partial
 * Session exists.
 */

import { stat } from 'node:fs/promises'
import { readTranscript } from './sources.js'
import { summarizeTranscript } from './summary.js'
import { buildContinueEvents, buildSummaryEvents, renderTranscript } from './transcript.js'
import { ImportError } from './transcript.js'

/**
 * Import one local agent session.
 * @param {object} request
 * @param {'codex' | 'pi' | 'claude'} request.source - source agent.
 * @param {string} request.file - absolute path inside that source's roots.
 * @param {string} request.workspaceId - target Workspace.
 * @param {'continue' | 'summary'} request.mode - replay the transcript or start from a summary.
 * @param {object} deps
 * @param {object} deps.workspaceRegistry - registry resolving the target.
 * @param {object} deps.persistence - durable Session store.
 * @param {object} [deps.projectionCache] - list projection cache refreshed after a write.
 * @param {object} [deps.llm] - LLM service used by summary mode.
 * @param {{ provider: string, model: string, reasoningEffort?: string } | undefined} deps.selection - summary model route.
 * @param {object} deps.config - plugin configuration.
 * @param {() => string} deps.createId - unique id source.
 * @param {(message: string) => void} deps.warn - host diagnostic.
 * @param {(phase: string, done: number, total: number) => void} [request.onProgress] - progress callback.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<{ sessionId: string, title: string | null, mode: string, source: string, file: string, messageCount: number, truncated?: boolean }>}
 */
export async function importSession(request, deps, signal, onProgress = () => {}) {
  const workspace = deps.workspaceRegistry.get(request.workspaceId)
  if (workspace === undefined) throw new ImportError('workspace-not-found', `workspace ${request.workspaceId} does not exist`)
  signal.throwIfAborted()

  onProgress('reading', 0, 1)
  const transcript = await readTranscript({
    source: request.source,
    file: request.file,
    home: deps.config.home,
    maxBytes: deps.config.maxTranscriptBytes,
  })
  signal.throwIfAborted()
  if (transcript.items.length === 0) {
    throw new ImportError('empty-conversation', 'the selected session contains no user or assistant messages')
  }

  let conversion
  let truncated = false
  if (request.mode === 'summary') {
    onProgress('summarizing', 0, 1)
    const summarized = await summarizeTranscript({
      llm: deps.llm,
      selection: deps.selection,
      transcript: renderTranscript(transcript),
      config: {
        summaryChunkChars: deps.config.summaryChunkChars,
        summaryMaxTokens: deps.config.summaryMaxTokens,
      },
      signal,
      onProgress: (phase, done, total) => { onProgress(phase, done, total) },
    })
    truncated = summarized.truncated
    signal.throwIfAborted()
    conversion = buildSummaryEvents(transcript, summarized.summary, {
      createId: deps.createId,
      maxTitleBytes: deps.config.maxTitleBytes,
    })
  } else {
    conversion = buildContinueEvents(transcript, {
      createId: deps.createId,
      maxTitleBytes: deps.config.maxTitleBytes,
      maxToolOutputChars: deps.config.maxToolOutputChars,
    })
  }

  onProgress('writing', 0, 1)
  await assertWorkspace(deps.workspaceRegistry, workspace, signal)
  const dsh = await Promise.resolve(deps.sessionModule)
  const version = typeof dsh?.SESSION_FORMAT_VERSION === 'number' ? dsh.SESSION_FORMAT_VERSION : 4
  const id = deps.createId()
  const header = {
    version,
    id,
    createdAt: conversion.createdAt,
    cwd: workspace.path,
    isSeeded: false,
  }
  // Construction runs the same seed validation as a live Session when the
  // running installation exposes it; persistence still enforces the format.
  if (typeof dsh?.Session?.create === 'function') dsh.Session.create(id, conversion.events, header)
  signal.throwIfAborted()

  const handle = await deps.persistence.create(header, { signal })
  try {
    await handle.append(conversion.events)
    await handle.flush()
  } finally {
    await handle.close()
  }
  const offset = typeof dsh?.SessionLogOffset === 'function' ? dsh.SessionLogOffset(0) : 0
  deps.projectionCache?.coldSnapshot(header, offset, conversion.events)
  try {
    await workspace.attachSession(id)
  } catch (error) {
    throw new ImportError(
      'attach-failed',
      `stored as Session ${id} but not added to the workspace: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  onProgress('writing', 1, 1)
  return {
    sessionId: id,
    title: conversion.title,
    mode: request.mode,
    source: request.source,
    file: request.file,
    messageCount: conversion.events.filter(event => event.type === 'user/message').length,
    ...truncated ? { truncated: true } : {},
  }
}

async function assertWorkspace(registry, workspace, signal) {
  signal.throwIfAborted()
  if (registry.get(workspace.id) === undefined) {
    throw new ImportError('workspace-not-found', `workspace ${workspace.id} was removed during the import`)
  }
  try {
    if (!(await stat(workspace.path)).isDirectory()) {
      throw new ImportError('workspace-not-found', `workspace directory ${workspace.path} no longer exists`)
    }
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError('workspace-not-found', `workspace directory ${workspace.path} is not readable`, { cause: error })
  }
}
