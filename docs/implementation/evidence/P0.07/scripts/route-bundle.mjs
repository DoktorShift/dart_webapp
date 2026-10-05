// P0.07: what the guest route "/" loads on first visit, measured from a production build.
// Usage: npm run build && node docs/implementation/evidence/P0.07/scripts/route-bundle.mjs [label]
// Prints the JavaScript files of "/" (layout + page), their raw and gzip sizes, and whether any
// of them contains code that must only ever arrive on demand (nostr-core, the QR decoder, the
// QR generator). Async chunks (import()) are listed separately; they are not part of first load.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, '.next/app-build-manifest.json'), 'utf8'))
const files = [...new Set([...(manifest.pages['/layout'] ?? []), ...(manifest.pages['/page'] ?? [])])].filter((f) => f.endsWith('.js'))

// String literals that survive minification and only occur in the given library (checked
// against node_modules/<lib>/dist on 4 October 2026).
const MARKERS = {
  'nostr-core': [/missing TLV 0 for/, /invalid plaintext size/, /Invalid nostr URI/, /auth timed out/],
  jsqr: [/Malformed data passed to binarizer/, /Invalid numeric value above 999/],
  'qrcode-generator': [/code length overflow/, /bad rs block/],
}

const kb = (n) => (n / 1024).toFixed(1)
let raw = 0
let gz = 0
const found = {}
const rows = files.map((file) => {
  const code = readFileSync(join(root, '.next', file))
  const text = code.toString('utf8')
  const size = code.length
  const gzip = gzipSync(code, { level: 9 }).length
  raw += size
  gz += gzip
  for (const [lib, patterns] of Object.entries(MARKERS)) if (patterns.some((p) => p.test(text))) (found[lib] ??= []).push(file)
  return { file, kB: kb(size), gzip_kB: kb(gzip) }
})

const label = process.argv[2] ?? ''
console.log(`Route "/" first-load JavaScript ${label}`)
console.table(rows)
console.log(`Total: ${kb(raw)} kB raw, ${kb(gz)} kB gzip, ${files.length} files`)
for (const lib of Object.keys(MARKERS)) console.log(`${lib} in first load: ${found[lib] ? 'YES ' + found[lib].join(', ') : 'no'}`)

// Every other chunk in the build: loaded only through import() or by another route.
const all = readdirSync(join(root, '.next/static/chunks'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => `static/chunks/${f}`)
const firstLoad = new Set(files)
const others = all.filter((f) => !firstLoad.has(f) && !f.includes('/pages/') && !/(framework|main|polyfills)-/.test(f))
const lazy = others.map((file) => {
  const text = readFileSync(join(root, '.next', file), 'utf8')
  const libs = Object.entries(MARKERS).filter(([, ps]) => ps.some((p) => p.test(text))).map(([lib]) => lib)
  return { file, kB: kb(text.length), contains: libs.join(', ') || '-' }
})
console.log('Other chunks (async or other routes):')
console.table(lazy)
