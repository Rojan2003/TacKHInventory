// Concatenates src/*.js into Code.gs so the backend can be pasted into the Apps Script editor as one file.
// Usage: node build.mjs   (run inside apps-script/)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('./src/', import.meta.url))
const out = fileURLToPath(new URL('./Code.gs', import.meta.url))
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
const parts = files.map((f) => `// ===================== ${f} =====================\n` + readFileSync(join(dir, f), 'utf8'))
const date = new Date().toISOString().slice(0, 10)
// Build id = date + short hash of the sources. The GET health ping returns it so you can see which bundle is live.
const buildId = `${date}-${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 8)}`
const header = `/**
 * East Congregation Literature Inventory - Apps Script backend (single-file bundle)
 * Generated from apps-script/src by \`node build.mjs\` on ${date}. Build id: ${buildId}
 * Edit the files in src/ and rebuild; do not edit this bundle by hand.
 */
var BUILD_ID = '${buildId}';
`
writeFileSync(out, header + parts.join('\n\n'))
console.log(`Code.gs written from ${files.length} files (build ${buildId})`)
