import type { Dart, Throw } from "../game/types.ts"
import { ProtocolError } from "./reasons.ts"

// Compact, lossless text form of the throw log (lib/game/types.ts) for live snapshots, results
// and private records: about 1.3 bytes per dart instead of ~73 as JSON. Grammar, version 1
// (docs/protocol/families/match-live.md, "Wurfkodierung"):
//
//   log    = "1" token*                    leading digit = format version
//   token  = meta | "!"? "#"? throw         "!" edited, "#" closesLeg (in this order)
//   meta   = "."                            next visit (visit + 1)
//          | "/"                            next leg (leg + 1, visit + 1)
//          | "[" visit? "," leg? "]"        set both tags; an empty side means "not tagged"
//   throw  = DART                           one character, table below
//          | "*"                            rest of the visit missed (noScore)
//          | "(v" total "," darts ["," atDouble] ")"   visit entered as a total
//          | "(t" player ")"                turn: this player throws now
//          | "(r" player ")"                retire: this player leaves the game
//
// Each throw carries the visit and leg tags of the cursor, which starts at visit 0, leg 0.
// DART: index = (segment − 1) · 3 + (multiplier − 1) for 1–20; 60 miss, 61 outer bull (25),
// 62 bull (50); the character is DART_ALPHABET[index].
//
// "Lossless" means: decode(encode(log)) equals the log as stored (JSON), so a key holding
// undefined counts as absent and a false flag as unset, exactly as the engine treats them.

export const THROWS_FORMAT = "1"
export const DART_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-"

const MISS_INDEX = 60
const OUTER_BULL_INDEX = 61
const BULL_INDEX = 62
const MAX_TAG = 999999
const MAX_PLAYER = 5

function dartIndex(d: Dart): number | null {
  if (d.segment >= 1 && d.segment <= 20 && Number.isInteger(d.segment) && [1, 2, 3].includes(d.multiplier))
    return (d.segment - 1) * 3 + (d.multiplier - 1)
  if (d.segment === 0 && d.multiplier === 1) return MISS_INDEX
  if (d.segment === 25 && d.multiplier === 1) return OUTER_BULL_INDEX
  if (d.segment === 25 && d.multiplier === 2) return BULL_INDEX
  return null
}

function dartAt(index: number): Dart {
  if (index === MISS_INDEX) return { segment: 0, multiplier: 1 }
  if (index === OUTER_BULL_INDEX) return { segment: 25, multiplier: 1 }
  if (index === BULL_INDEX) return { segment: 25, multiplier: 2 }
  return { segment: Math.floor(index / 3) + 1, multiplier: ((index % 3) + 1) as Dart["multiplier"] }
}

const tagOk = (n: number | undefined) => n === undefined || (Number.isSafeInteger(n) && n >= 0 && n <= MAX_TAG)
const playerOk = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_PLAYER

interface Cursor {
  visit: number | undefined
  leg: number | undefined
}

function metaTokens(cur: Cursor, next: Cursor): string {
  if (cur.visit === next.visit && cur.leg === next.leg) return ""
  if (cur.visit !== undefined && cur.leg !== undefined && next.visit !== undefined && next.leg !== undefined) {
    const dv = next.visit - cur.visit
    const dl = next.leg - cur.leg
    if (dl === 0 && dv >= 1 && dv <= 3) return ".".repeat(dv)
    if (dl === 1 && dv >= 1 && dv <= 3) return "/" + ".".repeat(dv - 1)
  }
  return `[${next.visit ?? ""},${next.leg ?? ""}]`
}

function throwToken(t: Throw, position: number): string {
  const bad = (what: string) => new ProtocolError("invalid_content", `throw ${position}: ${what}`)
  switch (t.kind) {
    case "dart": {
      const index = dartIndex(t.dart)
      if (index === null) throw bad(`no such dart ${JSON.stringify(t.dart)}`)
      return DART_ALPHABET[index]
    }
    case "noScore":
      return "*"
    case "visit": {
      const { total, darts, atDouble } = t
      if (!Number.isInteger(total) || total < 0 || total > 180) throw bad(`visit total ${total}`)
      if (!Number.isInteger(darts) || darts < 1 || darts > 3) throw bad(`visit darts ${darts}`)
      if (atDouble !== undefined && (!Number.isInteger(atDouble) || atDouble < 0 || atDouble > 3)) throw bad(`darts at double ${atDouble}`)
      return atDouble === undefined ? `(v${total},${darts})` : `(v${total},${darts},${atDouble})`
    }
    case "turn":
    case "retire":
      if (!playerOk(t.player)) throw bad(`player ${t.player}`)
      return `(${t.kind === "turn" ? "t" : "r"}${t.player})`
    default:
      throw bad("unknown kind")
  }
}

// The whole log as one body plus where each throw's own characters start (after its meta
// tokens), so the text from any throw on is known without encoding again.
function encodeBody(throws: readonly Throw[]): { body: string; starts: number[] } {
  let body = ""
  const starts: number[] = []
  let cur: Cursor = { visit: 0, leg: 0 }
  for (let i = 0; i < throws.length; i++) {
    const t = throws[i]
    if (!tagOk(t.visit) || !tagOk(t.leg)) throw new ProtocolError("invalid_content", `throw ${i}: visit or leg tag out of range`)
    const next = { visit: t.visit, leg: t.leg }
    body += metaTokens(cur, next)
    cur = next
    starts.push(body.length)
    if (t.edited) body += "!"
    if (t.closesLeg) body += "#"
    body += throwToken(t, i)
  }
  return { body, starts }
}

const tailText = (throws: readonly Throw[], encoded: { body: string; starts: number[] }, from: number) =>
  from === 0
    ? THROWS_FORMAT + encoded.body
    : THROWS_FORMAT + metaTokens({ visit: 0, leg: 0 }, { visit: throws[from].visit, leg: throws[from].leg }) + encoded.body.slice(encoded.starts[from])

// The log from `from` on; a snapshot that only carries the end of a long match starts there
// (the first meta token then sets the cursor to that throw's tags).
export function encodeThrows(throws: readonly Throw[], from = 0): string {
  if (from >= throws.length) return THROWS_FORMAT
  return tailText(throws, encodeBody(throws), from)
}

// The longest end of the log that fits `maxLength` characters: the whole log, else from
// `preferFrom` (the start of the current leg), else from the earliest visit start that fits.
export function encodeThrowsTail(throws: readonly Throw[], maxLength: number, preferFrom?: number): { text: string; from: number } {
  if (throws.length === 0) return { text: THROWS_FORMAT, from: 0 }
  const encoded = encodeBody(throws)
  const fits = (from: number) => tailText(throws, encoded, from).length <= maxLength
  if (fits(0)) return { text: tailText(throws, encoded, 0), from: 0 }
  if (preferFrom !== undefined && preferFrom > 0 && preferFrom < throws.length && fits(preferFrom)) return { text: tailText(throws, encoded, preferFrom), from: preferFrom }
  // Visit starts only, so a snapshot never begins in the middle of a visit.
  const visitStart = (i: number) => i === 0 || throws[i].visit === undefined || throws[i].visit !== throws[i - 1].visit
  let from = throws.length - 1
  while (from > 0 && !visitStart(from)) from--
  for (let i = from - 1; i > 0; i--) {
    if (!visitStart(i)) continue
    if (!fits(i)) break
    from = i
  }
  return { text: tailText(throws, encoded, from), from }
}

export function decodeThrows(encoded: string): Throw[] {
  if (encoded[0] !== THROWS_FORMAT) throw new ProtocolError("invalid_content", `throw log format "${encoded[0] ?? ""}" unknown`)
  const out: Throw[] = []
  let cur: Cursor = { visit: 0, leg: 0 }
  let i = 1
  const bad = (what: string) => new ProtocolError("invalid_content", `throw log position ${i}: ${what}`)

  // Digits up to `stop`; an empty run is allowed only where a tag may be absent.
  const number = (stop: string, allowEmpty: boolean): number | undefined => {
    const start = i
    while (i < encoded.length && encoded[i] >= "0" && encoded[i] <= "9") i++
    if (encoded[i] !== stop) throw bad(`expected "${stop}"`)
    const digits = encoded.slice(start, i)
    i++
    if (digits === "") {
      if (allowEmpty) return undefined
      throw bad("number missing")
    }
    if (digits.length > 1 && digits[0] === "0") throw bad("leading zero")
    return Number(digits)
  }

  while (i < encoded.length) {
    const c = encoded[i]
    if (c === ".") {
      if (cur.visit === undefined) throw bad("next visit without a visit tag")
      cur = { visit: cur.visit + 1, leg: cur.leg }
      i++
      continue
    }
    if (c === "/") {
      if (cur.visit === undefined || cur.leg === undefined) throw bad("next leg without tags")
      cur = { visit: cur.visit + 1, leg: cur.leg + 1 }
      i++
      continue
    }
    if (c === "[") {
      i++
      const visit = number(",", true)
      const leg = number("]", true)
      cur = { visit, leg }
      if (!tagOk(visit) || !tagOk(leg)) throw bad("tag out of range")
      continue
    }

    const edited = c === "!"
    if (edited) i++
    const closesLeg = encoded[i] === "#"
    if (closesLeg) i++

    const meta = {
      ...(cur.visit !== undefined ? { visit: cur.visit } : {}),
      ...(cur.leg !== undefined ? { leg: cur.leg } : {}),
      ...(edited ? { edited: true } : {}),
      ...(closesLeg ? { closesLeg: true } : {}),
    }
    if (!tagOk(cur.visit) || !tagOk(cur.leg)) throw bad("tag out of range")

    const k = encoded[i]
    if (k === undefined) throw bad("flag without a throw")
    if (k === "*") {
      out.push({ kind: "noScore", ...meta })
      i++
    } else if (k === "(") {
      const what = encoded[i + 1]
      i += 2
      if (what === "v") {
        const start = i
        const close = encoded.indexOf(")", start)
        if (close < 0) throw bad("unclosed visit")
        const parts = encoded.slice(start, close).split(",")
        if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^(0|[1-9][0-9]{0,2})$/.test(p))) throw bad("malformed visit")
        const [total, darts, atDouble] = parts.map(Number)
        if (total > 180 || darts < 1 || darts > 3 || (atDouble !== undefined && atDouble > 3)) throw bad("visit out of range")
        out.push({ kind: "visit", total, darts, ...(atDouble !== undefined ? { atDouble } : {}), ...meta })
        i = close + 1
      } else if (what === "t" || what === "r") {
        const player = number(")", false) as number
        if (!playerOk(player)) throw bad("player out of range")
        out.push({ kind: what === "t" ? "turn" : "retire", player, ...meta })
      } else {
        throw bad(`unknown entry "(${what ?? ""}"`)
      }
    } else {
      const index = DART_ALPHABET.indexOf(k)
      if (index < 0) throw bad(`unknown character "${k}"`)
      out.push({ kind: "dart", dart: dartAt(index), ...meta })
      i++
    }
  }
  return out
}
