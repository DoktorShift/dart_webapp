// The import boundary of decision 0002 (A25): nostr-core's code is imported only by
// lib/nostr/runtime.ts, and that module is reached only through the dynamic import in
// lib/nostr/core.ts, so the guest path never downloads it. Everything else names its types
// through lib/nostr/types.ts.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const SOURCES = ["app", "components", "hooks", "lib", "types"]

function files(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry) ? [path] : []
  })
}

// Code only: comments may quote an import (runtime.ts explains why it avoids `import("nostr-core")`).
// String literals are matched first so a "//" inside one (a relay URL) isn't taken for a comment.
const withoutComments = (text: string) =>
  text.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, literal?: string) => literal ?? "")

const sources = SOURCES.flatMap((dir) => files(join(ROOT, dir))).map((path) => ({ path: relative(ROOT, path), text: withoutComments(readFileSync(path, "utf8")) }))

// Static import/export statements naming nostr-core (possibly spanning lines), and whether they
// are type-only.
const staticImports = (text: string) =>
  [...text.matchAll(/\b(import|export)\s+(type\s+)?(?:[^;'"]*?\bfrom\s+)?["']nostr-core(?:\/[^"']*)?["']/g)].map((match) => ({ statement: match[0], typeOnly: !!match[2] }))

const dynamicImports = (text: string) => [...text.matchAll(/(?<!typeof\s)\bimport\(\s*["']nostr-core(?:\/[^"']*)?["']\s*\)/g)].map((match) => match[0])

test("the check reads code, not comments", () => {
  const sample = 'const a = "wss://r.example" // import("nostr-core")\n/* import("nostr-core") */ await import("nostr-core")'
  assert.deepEqual(dynamicImports(withoutComments(sample)), ['import("nostr-core")'])
  assert.match(withoutComments(sample), /"wss:\/\/r\.example"/)
})

test("only lib/nostr/ names nostr-core at all; everything else uses lib/nostr/types.ts", () => {
  const outside = sources.filter(({ path }) => !path.startsWith("lib/nostr/") && /["']nostr-core(\/[^"']*)?["']/.test(text(path)))
  assert.deepEqual(outside.map(({ path }) => path), [])
})

test("inside lib/nostr/, only runtime.ts imports nostr-core's code; everything else is type-only", () => {
  const offenders = sources
    .filter(({ path }) => path.startsWith("lib/nostr/") && path !== "lib/nostr/runtime.ts")
    .flatMap(({ path, text }) => staticImports(text).filter((found) => !found.typeOnly).map((found) => `${path}: ${found.statement}`))
  assert.deepEqual(offenders, [])
  assert.ok(staticImports(text("lib/nostr/runtime.ts")).some((found) => !found.typeOnly))
  assert.deepEqual(sources.flatMap(({ path, text }) => dynamicImports(text).map(() => path)), [])
})

test("runtime.ts is reached only through the dynamic import in core.ts", () => {
  const mentions = sources.flatMap(({ path, text }) =>
    [...text.matchAll(/(typeof\s+)?\bimport\(\s*["'][^"']*runtime(\.ts)?["']\s*\)|\bfrom\s+["'][^"']*\/runtime(\.ts)?["']/g)]
      .filter((match) => !match[1])
      .map((match) => `${path}: ${match[0]}`),
  )
  assert.deepEqual(mentions, ['lib/nostr/core.ts: import("./runtime.ts")'])
})

function text(path: string) {
  return sources.find((source) => source.path === path)?.text ?? ""
}
