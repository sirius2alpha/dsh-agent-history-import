# Agent history import

Import a conversation from **Codex**, **Pi**, or **Claude Code** on this computer into DSH and continue it.

Two modes:

- **Continue with full context** — the whole transcript, including tool calls and their results, becomes a stored DSH Session. Open it and keep chatting from where the original work stopped.
- **Summarize into a new conversation** — the configured default model writes a detailed handover summary, which becomes the first user message of a new DSH Session.

The import button sits beside **New session** in the sidebar. The dialog lists recent sessions per source, lets you pick a workspace, and imports over an owner-only local route. Nothing leaves the computer except the summary-model request in summary mode.

The same capability is available as the `agent_history_import` tool: `action: "list"` returns the local sessions, and `action: "import"` with `source`, `file`, and `mode` imports one into the current workspace. This is useful when you already know which conversation you want, or when you are driving DSH from an automated session.

## Install

Requires DSH 0.2.2-rc.3 or newer.

```sh
dsh plugin --profile <your-profile> add dsh-agent-history-import
```

Or install the package directory directly:

```sh
dsh plugin --profile <your-profile> add /path/to/agent-history-import
```

Restart DSH, or hard-refresh the Web client, after installing.

## Sources

| Source | Directory |
|---|---|
| Codex | `~/.codex/sessions` (and `archived_sessions` without compressed logs) |
| Pi | `~/.pi/agent/sessions` |
| Claude Code | `~/.claude/projects` |

## Known limits

- Codex reasoning records are encrypted and are not imported.
- Claude Code sidechains are skipped; the main conversation is imported.
- Tool output is truncated in continue mode (default 4,000 characters) to keep the context usable.
- The session list shows the latest 80 sessions per source by default (`maxSessions`).
- Re-importing the same session writes another DSH Session.
- Summary mode sends the transcript to the configured default model. Very long transcripts (over 1,200,000 characters) are summarized from their first part only, and the dialog warns about it.
- Cancelling an import keeps Sessions already written; it does not retry them.

See `docs/DETAIL.md` for the full behavior.
