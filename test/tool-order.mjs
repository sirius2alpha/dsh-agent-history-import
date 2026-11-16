/**
 * Regression test: a source may place tool results after another assistant
 * message. Closing the call's step before its result previously made the stored
 * Session corrupt with "step/end leaves unresolved tool call".
 *
 * Run with the DSH Electron node:
 *   ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/tool-order.mjs
 */

import { randomUUID } from 'node:crypto'
import { loadDshSession } from '../src/dsh.js'
import { buildContinueEvents } from '../src/transcript.js'

const transcript = {
  source: 'claude',
  title: 'Tool result ordering',
  cwd: '/tmp',
  createdAt: 1,
  stats: { userMessages: 1, assistantMessages: 2, toolResults: 2 },
  items: [
    { role: 'user', text: 'Check both commands.', time: 1 },
    { role: 'assistant', toolCalls: [{ id: 'tool_a', name: 'Bash', arguments: '{"command":"a"}' }], time: 2 },
    { role: 'assistant', toolCalls: [{ id: 'tool_b', name: 'Bash', arguments: '{"command":"b"}' }], time: 3 },
    { role: 'tool', callId: 'tool_a', toolName: 'Bash', text: 'result a', time: 4 },
    { role: 'tool', callId: 'tool_b', toolName: 'Bash', text: 'result b', time: 5 },
  ],
}

const conversion = buildContinueEvents(transcript, { createId: () => randomUUID(), maxTitleBytes: 80 })
const open = new Set()
for (const event of conversion.events) {
  if (event.type === 'tool/call') open.add(event.data.callId)
  else if (event.type === 'tool/result') open.delete(event.data.message.toolCallId)
  else if (event.type === 'step/end' && open.size > 0) {
    throw new Error(`step ${event.data.step} leaves unresolved calls: ${[...open].join(', ')}`)
  }
}

const dsh = await loadDshSession()
if (dsh === null) throw new Error('the DSH session module is required for this test')
const header = { version: dsh.SESSION_FORMAT_VERSION, id: randomUUID(), createdAt: conversion.createdAt, cwd: '/tmp', isSeeded: false }
dsh.Session.create(header.id, conversion.events, header)
console.log(`tool-order: valid (${conversion.events.length} events)`)
