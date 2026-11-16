/**
 * Local smoke test for the source parsers and seed conversion. Run with the
 * DSH Electron node so the bundled modules resolve the same way:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/run.mjs
 */

import { listSessions, listSources, readTranscript } from '../src/sources.js'
import { buildContinueEvents, renderTranscript } from '../src/transcript.js'

const sources = await listSources()
console.log('sources:', sources.map(source => `${source.id}=${source.available}`).join(' '))

for (const source of sources) {
  if (!source.available) continue
  const listed = await listSessions({ source: source.id, limit: 3 })
  console.log(`\n== ${source.id}: ${listed.sessions.length} listed of ${listed.scanned} scanned`)
  for (const session of listed.sessions) {
    console.log(`- ${new Date(session.updatedAt).toISOString()} ${session.title}`)
    console.log(`  cwd=${session.cwd} bytes=${session.bytes}`)
  }
  if (listed.sessions.length === 0) continue
  const transcript = await readTranscript({ source: source.id, file: listed.sessions[0].file })
  console.log(`  parsed: ${transcript.items.length} items, stats=${JSON.stringify(transcript.stats)}`)
  const rendered = renderTranscript(transcript)
  console.log(`  rendered: ${rendered.length} chars`)
  const conversion = buildContinueEvents(transcript, { createId: () => crypto.randomUUID(), maxTitleBytes: 80 })
  console.log(`  seed: title=${JSON.stringify(conversion.title)} events=${conversion.events.length}`)
  const types = {}
  for (const event of conversion.events) types[event.type] = (types[event.type] ?? 0) + 1
  console.log(`  event types: ${JSON.stringify(types)}`)
  for (const [index, event] of conversion.events.entries()) {
    if (event.seq !== index) throw new Error(`event ${index} has seq ${event.seq}`)
    if (index > 0 && event.time < conversion.events[index - 1].time) {
      throw new Error(`event ${index} time decreased`)
    }
  }
  console.log('  invariants: ok')
}
