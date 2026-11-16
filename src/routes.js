/**
 * Authenticated Fetch routes for the browser half.
 *
 * `GET  /api/agent-history-import/sources`  which local agents were found
 * `GET  /api/agent-history-import/sessions` recent sessions of one source
 * `POST /api/agent-history-import/import`   one NDJSON streamed import
 *
 * Routes are registered on `ctx.connection.fetch`, which admits only the owner
 * Peer, so the dialog never needs a separate authorization step.
 */

import { listSessions, listSources, SOURCE_IDS } from './sources.js'
import { importSession } from './importer.js'

/** Route paths shared by the Host registration and the browser calls. */
export const ROUTES = {
  sources: '/api/agent-history-import/sources',
  sessions: '/api/agent-history-import/sessions',
  import: '/api/agent-history-import/import',
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

const NDJSON_HEADERS = {
  'content-type': 'application/x-ndjson; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
}

/**
 * GET the availability of every supported source and whether summary mode has
 * a model route.
 * @param {object} deps - importer dependencies, for the summary route.
 * @returns {Promise<Response>}
 */
export async function handleSources(deps) {
  try {
    const sources = await listSources()
    const selection = deps?.selection
    const summary = {
      available: typeof deps?.llm?.stream === 'function'
        && typeof selection?.provider === 'string' && selection.provider.length > 0
        && typeof selection?.model === 'string' && selection.model.length > 0,
      provider: typeof selection?.provider === 'string' ? selection.provider : null,
      model: typeof selection?.model === 'string' ? selection.model : null,
    }
    return json({ sources, summary })
  } catch (error) {
    return failure(500, 'scan-failed', error)
  }
}

/**
 * GET the recent sessions of one source.
 * @param {Request} request - request carrying `source` and optional `limit`.
 * @returns {Promise<Response>}
 */
export async function handleSessions(request, defaultLimit = 80) {
  const url = new URL(request.url)
  const source = url.searchParams.get('source') ?? ''
  if (!SOURCE_IDS.includes(source)) {
    return json({ error: { reason: 'unknown-source', message: `source must be one of ${SOURCE_IDS.join(', ')}` } }, 400)
  }
  const limitParam = Number(url.searchParams.get('limit') ?? String(defaultLimit))
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : defaultLimit
  try {
    const result = await listSessions({ source, limit })
    return json(result)
  } catch (error) {
    return failure(500, 'scan-failed', error)
  }
}

/**
 * POST one import and stream progress and the outcome as newline-delimited JSON.
 * @param {Request} request - JSON body `{ source, file, workspaceId, mode }`.
 * @param {object} deps - importer dependencies.
 * @param {AbortSignal} lifecycle - aborted when the plugin unloads.
 * @returns {Promise<Response>}
 */
export async function handleImport(request, deps, lifecycle) {
  let body
  try {
    body = await request.json()
  } catch (_invalidJson) {
    return json({ error: { reason: 'bad-request', message: 'the request body is not JSON' } }, 400)
  }
  const source = body?.source
  const file = body?.file
  const workspaceId = body?.workspaceId
  const mode = body?.mode === 'summary' ? 'summary' : body?.mode === 'continue' ? 'continue' : undefined
  if (!SOURCE_IDS.includes(source) || typeof file !== 'string' || file.length === 0
    || typeof workspaceId !== 'string' || workspaceId.length === 0 || mode === undefined) {
    return json({
      error: {
        reason: 'bad-request',
        message: 'source, file, workspaceId, and mode (continue or summary) are required',
      },
    }, 400)
  }
  const signal = AbortSignal.any([request.signal, lifecycle])
  const stream = new ReadableStream({
    start(controller) {
      let open = true
      const send = (line) => {
        if (open) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`))
      }
      importSession({ source, file, workspaceId, mode }, deps, signal, (phase, done, total) => {
        send({ type: 'progress', phase, done, total })
      }).then((value) => {
        send({ type: 'outcome', outcome: { ok: true, value } })
        if (open) controller.close()
        open = false
      }, (error) => {
        if (signal.aborted) {
          if (open) controller.close()
          open = false
          return
        }
        const reason = typeof error?.reason === 'string' ? error.reason : 'internal'
        const message = error instanceof Error ? error.message : String(error)
        deps.failed(error)
        send({ type: 'outcome', outcome: { ok: false, error: { reason, message } } })
        if (open) controller.close()
        open = false
      })
    },
    cancel() {
      // The client closed the dialog; the request signal already aborts the import.
    },
  })
  return new Response(stream, { status: 200, headers: NDJSON_HEADERS })
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function failure(status, reason, error) {
  return json({ error: { reason, message: error instanceof Error ? error.message : String(error) } }, status)
}
