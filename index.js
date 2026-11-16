/**
 * Agent history import: brings conversations written by Codex, Pi, and Claude
 * Code on this computer into DSH.
 *
 * The Host registers three owner-only Fetch routes. The browser half lists the
 * available sessions, lets the user pick one, a target Workspace, and a mode,
 * then streams the import result. Two modes are offered:
 *
 * - `continue` writes the whole transcript as a stored Session, so opening it
 *   continues from the original context.
 * - `summary` asks the configured default model for a detailed handover
 *   summary and writes a new Session whose first user message is that summary.
 *
 * @module dsh-agent-history-import
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { loadDshSession } from './src/dsh.js'
import { handleImport, handleSessions, handleSources, ROUTES } from './src/routes.js'
import { createTool } from './src/tool.js'

/** Largest session file one import reads. */
const DEFAULT_MAX_TRANSCRIPT_BYTES = 48 * 1024 * 1024

/** Services the Host half requires. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry', 'tools']

/**
 * Register the import routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} rawConfig - row configuration.
 */
export function apply(ctx, rawConfig = {}) {
  const config = {
    maxSessions: positive(rawConfig.maxSessions, 80),
    maxTranscriptBytes: positive(rawConfig.maxTranscriptBytes, DEFAULT_MAX_TRANSCRIPT_BYTES),
    maxTitleBytes: positive(rawConfig.maxTitleBytes, 80),
    maxToolOutputChars: positive(rawConfig.maxToolOutputChars, 4000),
    summaryChunkChars: positive(rawConfig.summaryChunkChars, 40000),
    summaryMaxTokens: positive(rawConfig.summaryMaxTokens, 8000),
    summaryProvider: typeof rawConfig.summaryProvider === 'string' ? rawConfig.summaryProvider : '',
    summaryModel: typeof rawConfig.summaryModel === 'string' ? rawConfig.summaryModel : '',
    home: typeof rawConfig.home === 'string' && rawConfig.home.length > 0 ? rawConfig.home : homedir(),
  }
  const lifecycle = new AbortController()
  const deps = {
    workspaceRegistry: ctx.workspaceRegistry,
    persistence: ctx.sessionPersistence,
    projectionCache: ctx.get('sessionProjectionCache'),
    llm: ctx.get('llm'),
    sessionModule: loadDshSession(),
    get selection() {
      return summarySelection(ctx, config)
    },
    config,
    createId: () => randomUUID(),
    warn: (message) => { ctx.logger.warn(message) },
    failed: (error) => { ctx.logger.error('agent-history-import: import failed', error) },
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTES.sources,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => handleSources(deps),
  }), 'agent-history-import: sources route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTES.sessions,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => handleSessions(request, config.maxSessions),
  }), 'agent-history-import: sessions route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTES.import,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleImport(request, deps, lifecycle.signal),
  }), 'agent-history-import: import route')

  ctx.effect(() => () => { lifecycle.abort() }, 'agent-history-import: running import')
  ctx.effect(() => ctx.tools.register(createTool(ctx, deps)), 'agent-history-import: tool')
  ctx.logger.info('agent-history-import: ready')
}

/**
 * Resolve the model route used by summary mode. An explicit configured pair
 * wins; otherwise the composition's default model selection is used.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - merged plugin configuration.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | undefined}
 */
function summarySelection(ctx, config) {
  if (config.summaryProvider !== '' && config.summaryModel !== '') {
    return { provider: config.summaryProvider, model: config.summaryModel }
  }
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    if (selection !== undefined) return selection
  } catch (_unavailable) {
    // A composition without a default-model service can still configure a route.
  }
  return undefined
}

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}
