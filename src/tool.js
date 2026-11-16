/**
 * Model-facing tool for the same import the browser dialog performs.
 *
 * It lists local sessions and imports one into the calling agent's Workspace,
 * which makes the feature usable from any conversation and gives the import a
 * testable entry point that does not depend on the sidebar.
 */

import { listSessions, listSources, SOURCE_IDS } from './sources.js'
import { importSession } from './importer.js'

/**
 * Build the tool definition.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} deps - importer dependencies.
 * @returns {object} tool definition for `ctx.tools.register`.
 */
export function createTool(ctx, deps) {
  return {
    name: 'agent_history_import',
    description: 'List conversation histories written by Codex, Pi, or Claude Code on this computer, or import one into the current workspace as a new DSH session. Mode "continue" replays the whole transcript with full context; mode "summary" writes a detailed handover summary as the new session context. Always call action "list" first to obtain a session file path.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'import'],
          description: 'List available sessions, or import the session named by source and file.',
        },
        source: {
          type: 'string',
          enum: SOURCE_IDS,
          description: 'Source agent. Optional for list, required for import.',
        },
        file: {
          type: 'string',
          description: 'Absolute session file path returned by action "list". Required for import.',
        },
        mode: {
          type: 'string',
          enum: ['continue', 'summary'],
          description: 'Import mode. Required for import.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const action = args?.action
      if (action === 'list') {
        const sources = await listSources(deps.config.home)
        if (typeof args?.source !== 'string') return { sources }
        if (!SOURCE_IDS.includes(args.source)) throw new Error(`source must be one of ${SOURCE_IDS.join(', ')}`)
        const listed = await listSessions({ source: args.source, home: deps.config.home, limit: 40 })
        return { sources, ...listed }
      }
      if (action !== 'import') throw new Error('action must be "list" or "import"')
      if (typeof args?.source !== 'string' || !SOURCE_IDS.includes(args.source)) {
        throw new Error(`source must be one of ${SOURCE_IDS.join(', ')}`)
      }
      if (typeof args?.file !== 'string' || args.file.length === 0) throw new Error('file is required for import')
      if (args?.mode !== 'continue' && args?.mode !== 'summary') throw new Error('mode must be "continue" or "summary"')
      const agent = exec.agent
      if (agent === undefined) throw new Error('this tool must run on behalf of an agent')
      const workingDirectory = ctx.get('workingDirectory')
      const cwd = workingDirectory?.get(agent.session) ?? agent.session.header.cwd
      const workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
      if (workspace === undefined) {
        throw new Error(`the current directory ${cwd} is not a registered workspace; open it as a workspace first`)
      }
      return await importSession({
        source: args.source,
        file: args.file,
        workspaceId: workspace.id,
        mode: args.mode,
      }, deps, exec.signal)
    },
  }
}
