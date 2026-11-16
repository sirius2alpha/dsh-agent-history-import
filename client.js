/**
 * Browser half of the agent history import.
 *
 * A small import button is layered onto the New-session row. The dialog itself
 * lives in `shell.overlay`, so it is framed by the application instead of a
 * sidebar row. Both halves are registered through slots and the modal talks to
 * the Host over the package's owner-only Fetch routes.
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-history-import',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'agentHistoryImport'
    const SOURCES = ['codex', 'pi', 'claude']

    const ROUTES = {
      sources: 'api/agent-history-import/sources',
      sessions: 'api/agent-history-import/sessions',
      import: 'api/agent-history-import/import',
    }

    const zh = {
      'action.label': '导入 Agent 会话',
      'dialog.title': '导入 Agent 历史会话',
      'dialog.description': '把本机 Codex、Pi 或 Claude Code 里的一个会话导入 DSH：带着完整上下文继续，或先总结成一份详细交接说明。',
      'dialog.source': '来源',
      'dialog.sessions': '会话',
      'dialog.filter': '筛选标题或目录',
      'dialog.loading': '正在读取会话…',
      'dialog.empty': '这个来源没有找到可导入的会话。',
      'dialog.noSources': '没有找到 Codex、Pi 或 Claude Code 的历史目录。',
      'dialog.retry': '重试',
      'dialog.mode': '导入方式',
      'mode.continue.label': '带完整上下文继续',
      'mode.continue.desc': '把整个会话（包括工具调用）写成新的 DSH 会话，打开后直接从原来的上下文继续。',
      'mode.summary.label': '总结后开始新对话',
      'mode.summary.desc': '先用当前模型生成一份详细的交接总结，再把总结作为新会话的起始上下文。',
      'mode.summary.unavailable': '当前没有可用的默认模型，暂时无法使用总结模式。',
      'dialog.workspace': '导入到工作区',
      'dialog.workspaceHint': '导入后会话会出现在这个工作区里。',
      'dialog.noWorkspace': '没有可用工作区，请先在侧边栏创建或打开一个目录。',
      'dialog.cancel': '取消',
      'dialog.close': '关闭',
      'dialog.import': '导入',
      'dialog.importing': '正在导入…',
      'dialog.reading': '正在读取会话…',
      'dialog.summarizing': '正在总结…',
      'dialog.summarizingPart': '正在总结第 {done}/{total} 部分…',
      'dialog.writing': '正在写入会话…',
      'dialog.resultTitle': '已导入会话',
      'dialog.resultHint': '会话已写入所选工作区，可以从侧边栏打开。',
      'dialog.resultTruncated': '会话很长，总结只覆盖了前一部分内容。',
      'dialog.listLimited': '仅显示最近 {count} 个会话（共 {scanned} 个）。',
      'dialog.noMatch': '没有匹配的会话。',
      'dialog.refreshFailed': '会话列表刷新失败，但会话已写入工作区。',
      'dialog.openSession': '打开会话',
      'source.codex': 'Codex',
      'source.pi': 'Pi',
      'source.claude': 'Claude Code',
      'error.unknown-source': '无法识别这个来源。',
      'error.bad-request': '导入请求不完整。',
      'error.outside-root': '所选会话不在支持的历史目录中。',
      'error.not-a-file': '所选会话不是一个文件。',
      'error.too-large': '会话文件过大，无法导入。',
      'error.empty-conversation': '这个会话没有可导入的消息。',
      'error.no-model': '总结模式需要一个可用的默认模型。',
      'error.summary-failed': '总结失败：{message}',
      'error.summary-empty': '总结模型没有返回内容。',
      'error.workspace-not-found': '所选工作区已不存在，请重新选择。',
      'error.attach-failed': '会话已写入，但没有加入工作区：{message}',
      'error.scan-failed': '读取本机会话失败：{message}',
      'error.internal': '导入失败：{message}',
    }

    const en = {
      'action.label': 'Import agent history',
      'dialog.title': 'Import agent history',
      'dialog.description': 'Bring one conversation from Codex, Pi, or Claude Code on this computer into DSH — continue with the full context or start from a detailed handover summary.',
      'dialog.source': 'Source',
      'dialog.sessions': 'Sessions',
      'dialog.filter': 'Filter by title or directory',
      'dialog.loading': 'Reading sessions…',
      'dialog.empty': 'No importable session was found for this source.',
      'dialog.noSources': 'No Codex, Pi, or Claude Code history directory was found.',
      'dialog.retry': 'Retry',
      'dialog.mode': 'Import mode',
      'mode.continue.label': 'Continue with full context',
      'mode.continue.desc': 'Write the whole conversation, including tool calls, as a new DSH session. Open it and continue where the original left off.',
      'mode.summary.label': 'Summarize into a new conversation',
      'mode.summary.desc': 'Ask the current model for a detailed handover summary, then start a new session from that summary.',
      'mode.summary.unavailable': 'No default model is configured, so summary mode is unavailable.',
      'dialog.workspace': 'Workspace',
      'dialog.workspaceHint': 'The imported session is added to this workspace.',
      'dialog.noWorkspace': 'No workspace is available. Create or open a directory from the sidebar first.',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close',
      'dialog.import': 'Import',
      'dialog.importing': 'Importing…',
      'dialog.reading': 'Reading the session…',
      'dialog.summarizing': 'Summarizing…',
      'dialog.summarizingPart': 'Summarizing part {done}/{total}…',
      'dialog.writing': 'Writing the session…',
      'dialog.resultTitle': 'Imported session',
      'dialog.resultHint': 'The session was written to the selected workspace. You can open it from the sidebar.',
      'dialog.resultTruncated': 'The session was very long; the summary covers only its first part.',
      'dialog.listLimited': 'Showing the latest {count} of {scanned} sessions.',
      'dialog.noMatch': 'No matching session.',
      'dialog.refreshFailed': 'The session list did not refresh, but the session was written.',
      'dialog.openSession': 'Open session',
      'source.codex': 'Codex',
      'source.pi': 'Pi',
      'source.claude': 'Claude Code',
      'error.unknown-source': 'This source is not recognized.',
      'error.bad-request': 'The import request is incomplete.',
      'error.outside-root': 'The selected session is outside the supported history directories.',
      'error.not-a-file': 'The selected session is not a file.',
      'error.too-large': 'The session file is too large to import.',
      'error.empty-conversation': 'This session has no importable messages.',
      'error.no-model': 'Summary mode needs a configured default model.',
      'error.summary-failed': 'Summarization failed: {message}',
      'error.summary-empty': 'The summary model returned no text.',
      'error.workspace-not-found': 'The selected workspace no longer exists. Choose another one.',
      'error.attach-failed': 'The session was written but not added to the workspace: {message}',
      'error.scan-failed': 'Could not read local sessions: {message}',
      'error.internal': 'Import failed: {message}',
    }

    const CSS = `
.ahi-trigger{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-left:4px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.ahi-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ahi-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,12,16,0.52);pointer-events:auto}
.ahi-panel{display:flex;flex-direction:column;width:min(760px,100%);max-height:min(88vh,820px);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 18px 56px rgba(0,0,0,0.35);overflow:hidden;outline:none}
.ahi-header{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 12px}
.ahi-heading{flex:1;min-width:0}
.ahi-title{margin:0;font-size:16px;font-weight:600;line-height:1.35}
.ahi-description{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.ahi-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.ahi-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ahi-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-body{display:grid;gap:16px;padding:4px 22px 18px;overflow-y:auto}
.ahi-section{display:grid;gap:8px}
.ahi-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ahi-sources{display:flex;flex-wrap:wrap;gap:6px}
.ahi-source{padding:5px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.ahi-source:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ahi-source[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.ahi-source:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-source:disabled{opacity:.45;cursor:default}
.ahi-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.ahi-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-input::placeholder{color:var(--dsw-alias-label-secondary)}
.ahi-list{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;max-height:238px;overflow-y:auto;background:var(--dsw-alias-bg-layer-1)}
.ahi-row{display:flex;gap:10px;align-items:flex-start;width:100%;box-sizing:border-box;padding:10px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.ahi-row:last-child{border-bottom:0}
.ahi-row:hover{background:var(--dsw-alias-bg-layer-2)}
.ahi-row[aria-checked="true"]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.ahi-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ahi-dot{width:14px;height:14px;margin-top:2px;border:2px solid var(--dsw-alias-border-l2);border-radius:50%;flex:none}
.ahi-row[aria-checked="true"] .ahi-dot{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 3px var(--dsw-alias-bg-layer-2);background:var(--dsw-alias-brand-primary)}
.ahi-rowText{min-width:0;flex:1;display:grid;gap:3px}
.ahi-rowTitle{font-size:13px;font-weight:500;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ahi-rowMeta{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ahi-placeholder{padding:22px 14px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ahi-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:620px){.ahi-modes{grid-template-columns:1fr}}
.ahi-mode{display:grid;gap:4px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.ahi-mode:hover{background:var(--dsw-alias-bg-layer-2)}
.ahi-mode[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.ahi-mode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-modeTitle{font-size:13px;font-weight:600;line-height:1.4}
.ahi-modeDesc{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.ahi-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.ahi-error{padding:9px 11px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
.ahi-progressRow{display:grid;gap:6px}
.ahi-progress{width:100%;height:6px;accent-color:var(--dsw-alias-brand-primary)}
.ahi-progressText{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ahi-done{display:grid;gap:6px;padding:18px 4px}
.ahi-doneTitle{font-size:14px;font-weight:600}
.ahi-doneText{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.ahi-footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay)}
.ahi-button{padding:7px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.ahi-button:hover{background:var(--dsw-alias-bg-layer-2)}
.ahi-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ahi-button[data-variant="primary"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.ahi-button[data-variant="primary"]:hover{background:var(--dsw-alias-brand-primary);opacity:.9}
.ahi-button:disabled{opacity:.5;cursor:default}
@media (prefers-reduced-motion:no-preference){.ahi-panel{animation:ahi-in .14s ease-out}@keyframes ahi-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}
`

    function createOpenStore() {
      let open = false
      let lastFocus = null
      const listeners = new Set()
      return {
        open() {
          lastFocus = document.activeElement
          open = true
          for (const listener of listeners) listener()
        },
        close() {
          open = false
          for (const listener of listeners) listener()
          if (lastFocus instanceof HTMLElement) lastFocus.focus()
          lastFocus = null
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        get() { return open },
      }
    }

    async function fetchJson(url, options) {
      const response = await fetch(new URL(url, document.baseURI), options)
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body?.error?.message ?? `HTTP ${response.status}`
        const error = new Error(message)
        error.reason = body?.error?.reason ?? 'internal'
        throw error
      }
      return body
    }

    async function readOutcome(response, onProgress) {
      if (response.body === null) {
        throw new Error('the server returned no response body')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let outcome
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          if (line.trim().length === 0) continue
          let parsed
          try { parsed = JSON.parse(line) } catch (_invalid) { throw new Error('the server sent an invalid progress line') }
          if (parsed?.type === 'progress') onProgress(parsed)
          else if (parsed?.type === 'outcome') outcome = parsed.outcome
        }
      }
      if (outcome === undefined) throw new Error('the server ended the import without a result')
      if (outcome.ok !== true) {
        const error = new Error(outcome.error?.message ?? 'the import failed')
        error.reason = outcome.error?.reason ?? 'internal'
        throw error
      }
      return outcome.value
    }

    function errorText(error, t) {
      const reason = typeof error?.reason === 'string' ? error.reason : 'internal'
      const message = error instanceof Error ? error.message : String(error)
      const key = `error.${reason}`
      const text = t(key, { message })
      return text === key ? t('error.internal', { message }) : text
    }

    function messageText(progress, t) {
      if (progress === null) return t('dialog.importing')
      switch (progress.phase) {
        case 'reading': return t('dialog.reading')
        case 'summarizing':
          return progress.total > 1 && progress.done > 0
            ? t('dialog.summarizingPart', { done: String(progress.done), total: String(progress.total) })
            : t('dialog.summarizing')
        case 'writing': return t('dialog.writing')
        default: return t('dialog.importing')
      }
    }

    function ImportIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, focusable: 'false',
        style: { display: 'block' },
      },
      h('path', { d: 'M12 3v11', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
      h('path', { d: 'M7.5 9.5 12 14l4.5-4.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M5 16v3.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }))
    }

    function CloseIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M4 4l8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function Action(props) {
      const { wide, children, t } = props
      const store = props.store
      return h(React.Fragment, null,
        h('style', null, CSS),
        children,
        h('button', {
          type: 'button',
          className: 'ahi-trigger',
          title: t('action.label'),
          'aria-label': t('action.label'),
          'aria-haspopup': 'dialog',
          onClick: () => { store.open() },
        }, h(ImportIcon, { size: wide ? 15 : 18 })))
    }

    function Dialog({ store, t, useWorkspaces, useSessions, refreshSessions, openSession }) {
      const [sources, setSources] = React.useState([])
      const [source, setSource] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [status, setStatus] = React.useState('loading')
      const [loadError, setLoadError] = React.useState(null)
      const [mode, setMode] = React.useState('continue')
      const [workspaceId, setWorkspaceId] = React.useState(undefined)
      const [phase, setPhase] = React.useState({ kind: 'editing' })
      const [error, setError] = React.useState(null)
      const [progress, setProgress] = React.useState(null)
      const [reloadKey, setReloadKey] = React.useState(0)
      const [summaryAvailable, setSummaryAvailable] = React.useState(null)
      const [listInfo, setListInfo] = React.useState({ truncated: false, scanned: 0 })
      const [refreshError, setRefreshError] = React.useState(false)
      const request = React.useRef(null)
      const panel = React.useRef(null)
      const closeButton = React.useRef(null)
      const runningRef = React.useRef(false)
      const workspaces = useWorkspaces(state => state.items)
      const currentSessionId = useSessions(state => Object.values(state.byId)
        .find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); close() }
        }
        document.addEventListener('keydown', onKey)
        closeButton.current?.focus()
        return () => { document.removeEventListener('keydown', onKey) }
      }, [])

      React.useEffect(() => () => { request.current?.abort() }, [])

      React.useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        setStatus('loading')
        setLoadError(null)
        fetchJson(ROUTES.sources, { signal: controller.signal }).then((body) => {
          if (cancelled) return
          const found = Array.isArray(body?.sources) ? body.sources : []
          setSources(found)
          setSummaryAvailable(body?.summary?.available === true)
          const first = found.find(item => item.available)
          if (first === undefined) {
            setStatus('empty')
            setSource(null)
          } else {
            setSource(previous => previous !== null && found.some(item => item.available && item.id === previous) ? previous : first.id)
            setStatus('ready')
          }
        }, (failure) => {
          if (cancelled || controller.signal.aborted) return
          setStatus('error')
          setLoadError(failure)
        })
        return () => { cancelled = true; controller.abort() }
      }, [reloadKey])

      React.useEffect(() => {
        if (source === null) return
        let cancelled = false
        const controller = new AbortController()
        setStatus('loading')
        setLoadError(null)
        setListInfo({ truncated: false, scanned: 0 })
        fetchJson(`${ROUTES.sessions}?source=${encodeURIComponent(source)}&limit=80`, { signal: controller.signal }).then((body) => {
          if (cancelled) return
          const found = Array.isArray(body?.sessions) ? body.sessions : []
          setSessions(found)
          setListInfo({ truncated: body?.truncated === true, scanned: typeof body?.scanned === 'number' ? body.scanned : found.length })
          setSelected(previous => previous !== null && found.some(item => item.file === previous.file) ? previous : (found[0] ?? null))
          setStatus(found.length === 0 ? 'empty' : 'ready')
        }, (failure) => {
          if (cancelled || controller.signal.aborted) return
          setStatus('error')
          setLoadError(failure)
        })
        return () => { cancelled = true; controller.abort() }
      }, [source, reloadKey])

      React.useEffect(() => {
        if (workspaces.length === 0) return
        setWorkspaceId((previous) => {          if (previous !== undefined && workspaces.some(item => item.workspaceId === previous)) return previous
          const current = currentSessionId === undefined
            ? undefined
            : workspaces.find(item => item.sessionIds.includes(currentSessionId))
          return current?.workspaceId ?? workspaces[0].workspaceId
        })
      }, [workspaces, currentSessionId])

      React.useEffect(() => {
        if (summaryAvailable === false) setMode('continue')
      }, [summaryAvailable])

      const close = (force = false) => {
        if (runningRef.current && !force) return
        request.current?.abort()
        store.close()
      }

      const importNow = () => {
        if (selected === null || workspaceId === undefined) return
        const controller = new AbortController()
        request.current = controller
        runningRef.current = true
        setError(null)
        setRefreshError(false)
        setProgress(null)
        setPhase({ kind: 'running' })
        fetch(new URL(ROUTES.import, document.baseURI), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source, file: selected.file, workspaceId, mode }),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null)
            const failure = new Error(body?.error?.message ?? `HTTP ${response.status}`)
            failure.reason = body?.error?.reason ?? 'internal'
            throw failure
          }
          return await readOutcome(response, (line) => {
            if (!controller.signal.aborted) setProgress(line)
          })
        }).then(async (value) => {
          if (controller.signal.aborted) return
          runningRef.current = false
          setPhase({ kind: 'done', value })
          try {
            await refreshSessions()
          } catch (failure) {
            console.warn('agent-history-import: session list refresh failed', failure)
            setRefreshError(true)
          }
        }, (failure) => {
          if (controller.signal.aborted) return
          runningRef.current = false
          setPhase({ kind: 'editing' })
          setError(failure)
        })
      }

      const openNow = () => {
        if (phase.kind !== 'done') return
        try {
          openSession(phase.value.sessionId)
          close(true)
        } catch (failure) {
          setError(failure)
        }
      }

      const filtered = query.trim().length === 0
        ? sessions
        : sessions.filter(session => `${session.title} ${session.cwd ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
      const running = phase.kind === 'running'
      runningRef.current = running
      const summaryReady = summaryAvailable === true
      const canImport = selected !== null && workspaceId !== undefined && !running && status === 'ready' && (mode !== 'summary' || summaryReady)
      const sourceLabel = (id) => t(`source.${id}`)
      const onPanelKeyDown = (event) => {
        if (event.key !== 'Tab') return
        const root = panel.current
        if (root === null) return
        const nodes = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter(node => node.offsetParent !== null)
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }

      return h('div', {
        className: 'ahi-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) close() },
      },
      h('div', {
        className: 'ahi-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'ahi-title',
        'aria-describedby': 'ahi-description',
        tabIndex: -1,
        ref: panel,
        onKeyDown: onPanelKeyDown,
      },
      h('div', { className: 'ahi-header' },
        h('div', { className: 'ahi-heading' },
          h('h2', { className: 'ahi-title', id: 'ahi-title' }, t('dialog.title')),
          h('p', { className: 'ahi-description', id: 'ahi-description' }, t('dialog.description'))),
        h('button', { ref: closeButton, type: 'button', className: 'ahi-close', 'aria-label': t('dialog.close'), title: t('dialog.close'), onClick: () => close(true) }, h(CloseIcon))),
      h('div', { className: 'ahi-body' },
        h('div', { className: 'ahi-section' },
          h('span', { className: 'ahi-label' }, t('dialog.source')),
          h('div', { className: 'ahi-sources', role: 'group', 'aria-label': t('dialog.source') },
            SOURCES.map(id => {
              const found = sources.find(item => item.id === id)
              const available = found?.available === true
              return h('button', {
                key: id, type: 'button', className: 'ahi-source',
                'aria-pressed': source === id, disabled: !available || running,
                onClick: () => {
                  if (!available || id === source) return
                  setSource(id)
                  setSelected(null)
                  setError(null)
                },
              }, sourceLabel(id))
            }))),
        h('div', { className: 'ahi-section' },
          h('span', { className: 'ahi-label' }, t('dialog.sessions')),
          h('input', {
            className: 'ahi-input', type: 'search', value: query,
            placeholder: t('dialog.filter'), 'aria-label': t('dialog.filter'),
            disabled: running,
            onChange: (event) => { setQuery(event.target.value) },
          }),
          h('div', { className: 'ahi-list', role: 'radiogroup', 'aria-label': t('dialog.sessions') },
            status === 'loading' ? h('div', { className: 'ahi-placeholder' }, t('dialog.loading'))
              : status === 'empty' ? h('div', { className: 'ahi-placeholder' }, sources.every(item => !item.available) ? t('dialog.noSources') : t('dialog.empty'))
                : status === 'error' ? h('div', { className: 'ahi-placeholder' },
                  errorText(loadError, t),
                  h('div', { style: { marginTop: '10px' } },
                    h('button', {
                      type: 'button', className: 'ahi-button',
                      onClick: () => { setReloadKey(value => value + 1) },
                    }, t('dialog.retry'))))
                  : filtered.length === 0 ? h('div', { className: 'ahi-placeholder' }, t('dialog.noMatch'))
                    : filtered.map(session => h('button', {
                      key: session.file, type: 'button', role: 'radio',
                      className: 'ahi-row', 'aria-checked': selected?.file === session.file,
                      disabled: running,
                      onClick: () => { setSelected(session); setError(null) },
                    },
                    h('span', { className: 'ahi-dot' }),
                    h('span', { className: 'ahi-rowText' },
                      h('span', { className: 'ahi-rowTitle', title: session.title }, session.title),
                      h('span', { className: 'ahi-rowMeta', title: session.cwd ?? '' },
                        `${new Date(session.updatedAt).toLocaleString()} · ${session.cwd ?? ''}`))))),
          listInfo.truncated && status === 'ready'
            ? h('span', { className: 'ahi-hint' }, t('dialog.listLimited', { count: String(sessions.length), scanned: String(listInfo.scanned) }))
            : null),
        h('div', { className: 'ahi-section' },
          h('span', { className: 'ahi-label' }, t('dialog.mode')),
          h('div', { className: 'ahi-modes', role: 'radiogroup', 'aria-label': t('dialog.mode') },
            h('button', {
              type: 'button', role: 'radio', className: 'ahi-mode',
              'aria-checked': mode === 'continue', disabled: running,
              onClick: () => { setMode('continue') },
            },
            h('span', { className: 'ahi-modeTitle' }, t('mode.continue.label')),
            h('span', { className: 'ahi-modeDesc' }, t('mode.continue.desc'))),
            h('button', {
              type: 'button', role: 'radio', className: 'ahi-mode',
              'aria-checked': mode === 'summary', disabled: running || !summaryReady,
              onClick: () => { if (summaryReady) setMode('summary') },
            },
            h('span', { className: 'ahi-modeTitle' }, t('mode.summary.label')),
            h('span', { className: 'ahi-modeDesc' }, t('mode.summary.desc')))),
          summaryAvailable === false ? h('span', { className: 'ahi-hint' }, t('mode.summary.unavailable')) : null),
        h('div', { className: 'ahi-section' },
          h('span', { className: 'ahi-label' }, t('dialog.workspace')),
          h('select', {
            className: 'ahi-input', value: workspaceId ?? '',
            'aria-label': t('dialog.workspace'), disabled: running || workspaces.length === 0,
            onChange: (event) => { setWorkspaceId(event.target.value === '' ? undefined : event.target.value); setError(null) },
          },
          workspaces.length === 0 ? h('option', { value: '' }, t('dialog.workspace')) : null,
          workspaces.map(workspace => h('option', { key: workspace.workspaceId, value: workspace.workspaceId, title: workspace.path }, workspace.title))),
          h('span', { className: 'ahi-hint' }, workspaces.length === 0 ? t('dialog.noWorkspace') : t('dialog.workspaceHint'))),
        running ? h('div', { className: 'ahi-progressRow', role: 'status', 'aria-live': 'polite' },
          h('progress', { className: 'ahi-progress', 'aria-label': messageText(progress, t),
            ...progress === null || progress.total === undefined ? {} : { value: progress.done, max: progress.total } }),
          h('span', { className: 'ahi-progressText' }, messageText(progress, t))) : null,
        error !== null ? h('div', { className: 'ahi-error', role: 'alert' }, errorText(error, t)) : null,
        phase.kind === 'done' ? h('div', { className: 'ahi-done', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'ahi-doneTitle' }, t('dialog.resultTitle')),
          phase.value.title !== null ? h('span', { className: 'ahi-doneText' }, phase.value.title) : null,
          h('span', { className: 'ahi-doneText' }, t('dialog.resultHint')),
          phase.value.truncated === true ? h('span', { className: 'ahi-error' }, t('dialog.resultTruncated')) : null,
          refreshError ? h('span', { className: 'ahi-error' }, t('dialog.refreshFailed')) : null) : null),
      h('div', { className: 'ahi-footer' },
        phase.kind === 'done'
          ? h(React.Fragment, null,
            h('button', { type: 'button', className: 'ahi-button', onClick: () => close(true) }, t('dialog.close')),
            h('button', { type: 'button', className: 'ahi-button', 'data-variant': 'primary', onClick: openNow }, t('dialog.openSession')))
          : h(React.Fragment, null,
            h('button', { type: 'button', className: 'ahi-button', onClick: () => close(true) }, t('dialog.cancel')),
            h('button', {
              type: 'button', className: 'ahi-button', 'data-variant': 'primary',
              disabled: !canImport,
              onClick: importNow,
            }, running ? messageText(progress, t) : t('dialog.import'))))))
    }

    function Overlay(props) {
      const { store, t, ...rest } = props
      const open = React.useSyncExternalStore(store.subscribe, store.get, store.get)
      if (!open) return null
      return h(React.Fragment, null,
        h('style', null, CSS),
        h(Dialog, {
          store, t,
          useWorkspaces: rest.useWorkspaces,
          useSessions: rest.useSessions,
          refreshSessions: rest.refreshSessions,
          openSession: rest.openSession,
        }))
    }

    function apply(ctx) {
      const store = createOpenStore()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-history-import: dictionaries')
      const injected = {
        refreshSessions: async () => {
          if (typeof ctx.sessions?.refresh !== 'function') throw new Error('the session list service does not support refresh')
          await ctx.sessions.refresh()
        },
        openSession: (sessionId) => {
          if (typeof ctx.uiWorkspace?.openSession !== 'function') throw new Error('opening a session is unavailable')
          ctx.uiWorkspace.openSession(sessionId)
        },
      }
      ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
        name: 'sidebar.session.action', id: 'agent-history-import', order: 6,
        locale: NS,
        inject: () => ({ store }),
      }, Action))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'agent-history-import', order: 60,
        locale: NS,
        inject: () => ({ store, ...injected }),
      }, Overlay))
    }

    return { inject: ['slots', 'locale', 'sessions', 'uiWorkspace'], apply }
  },
})
