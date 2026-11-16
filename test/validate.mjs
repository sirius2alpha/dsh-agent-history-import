/**
 * Validate generated seed logs with the real Session constructor. Run with the
 * DSH Electron node and the running installation in DSH_INSTALL_DIR:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/validate.mjs
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { listSessions, listSources, readTranscript } from '../src/sources.js'
import { buildContinueEvents, buildSummaryEvents } from '../src/transcript.js'

const require = createRequire(import.meta.url)
const manifest = require.resolve('@deepseek-ai/dsh-session/package.json', { paths: [process.env.DSH_INSTALL_DIR] })
const session = await import(pathToFileURL(join(dirname(manifest), 'lib', 'index.js')).href)
const { Session, SESSION_FORMAT_VERSION } = session

const sources = await listSources()
for (const source of sources) {
  if (!source.available) continue
  const listed = await listSessions({ source: source.id, limit: 1 })
  if (listed.sessions.length === 0) continue
  const transcript = await readTranscript({ source: source.id, file: listed.sessions[0].file })
  for (const mode of ['continue', 'summary']) {
    const conversion = mode === 'continue'
      ? buildContinueEvents(transcript, { createId: () => randomUUID(), maxTitleBytes: 80 })
      : buildSummaryEvents(transcript, '## Summary\n\nA short test summary for validation.', { createId: () => randomUUID(), maxTitleBytes: 80 })
    const header = { version: SESSION_FORMAT_VERSION, id: randomUUID(), createdAt: conversion.createdAt, cwd: process.cwd(), isSeeded: false }
    try {
      Session.create(header.id, conversion.events, header)
      console.log(`${source.id}/${mode}: valid (${conversion.events.length} events)`)
    } catch (error) {
      console.error(`${source.id}/${mode}: INVALID`)
      console.error(error)
      process.exitCode = 1
    }
  }
}
