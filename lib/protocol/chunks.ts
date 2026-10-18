import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils"
import { ProtocolError } from "./reasons.ts"
import { utf8Length } from "./schema.ts"

// Data too large for one event (a long match log, a big private record) is cut into pieces
// by byte budget and chained by hash:
//
//   prev_0 = 64 × "0",  hash_i = sha256(prev_i ‖ data_i),  prev_(i+1) = hash_i,  head = hash_(n−1)
//
// (‖ joins the UTF-8 bytes of the hex string and of the data). Every piece names the head, so
// a reader groups pieces of one set and checks the chain, and the referring record (match
// result, private record) names the head, piece count and total size.

export interface Chunk {
  // The chain's head: identifies the set.
  set: string
  seq: number
  total: number
  prev: string
  data: string
}

const GENESIS = "0".repeat(64)

const chainHash = (prev: string, data: string) => bytesToHex(sha256(utf8ToBytes(prev + data)))

// Bytes a character (code point) occupies once the piece is written as a JSON string value.
function jsonCost(ch: string) {
  const c = ch.codePointAt(0) as number
  if (c === 0x22 || c === 0x5c) return 2
  if (c < 0x20) return c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : 6
  if (c < 0x80) return 1
  if (c < 0x800) return 2
  if (c >= 0xd800 && c <= 0xdfff) return 6
  return c < 0x10000 ? 3 : 4
}

export function chunkData(data: string, budget: number): { chunks: Chunk[]; head: string; bytes: number } {
  if (!Number.isInteger(budget) || budget < 16) throw new ProtocolError("invalid_content", "chunk budget too small")
  const pieces: string[] = []
  let start = 0
  let size = 0
  let i = 0
  while (i < data.length) {
    const ch = String.fromCodePoint(data.codePointAt(i) as number)
    const cost = jsonCost(ch)
    if (size + cost > budget && i > start) {
      pieces.push(data.slice(start, i))
      start = i
      size = 0
    }
    size += cost
    i += ch.length
  }
  if (i > start || pieces.length === 0) pieces.push(data.slice(start))

  let prev = GENESIS
  const linked = pieces.map((p, seq) => {
    const link = { seq, prev, data: p }
    prev = chainHash(prev, p)
    return link
  })
  const head = prev
  return {
    chunks: linked.map((c) => ({ set: head, seq: c.seq, total: pieces.length, prev: c.prev, data: c.data })),
    head,
    bytes: utf8Length(data),
  }
}

// Puts a set back together. Pieces may arrive in any order and more than once; anything that
// does not match the expected head, count or size is an error, never a partial result.
export function assembleChunks(chunks: readonly Chunk[], expect: { head: string; total: number; bytes?: number }): string {
  const bySeq = new Map<number, Chunk>()
  for (const c of chunks) {
    if (c.set !== expect.head) continue
    const seen = bySeq.get(c.seq)
    if (seen && (seen.data !== c.data || seen.prev !== c.prev)) throw new ProtocolError("invalid_content", `piece ${c.seq} differs between copies`)
    bySeq.set(c.seq, c)
  }
  let prev = GENESIS
  let data = ""
  for (let seq = 0; seq < expect.total; seq++) {
    const c = bySeq.get(seq)
    if (!c) throw new ProtocolError("invalid_content", `piece ${seq} of ${expect.total} missing`)
    if (c.total !== expect.total) throw new ProtocolError("invalid_content", `piece ${seq} claims ${c.total} pieces`)
    if (c.prev !== prev) throw new ProtocolError("invalid_content", `piece ${seq} does not follow piece ${seq - 1}`)
    prev = chainHash(prev, c.data)
    data += c.data
  }
  if (prev !== expect.head) throw new ProtocolError("invalid_content", "pieces do not end at the expected head")
  if (expect.bytes !== undefined && utf8Length(data) !== expect.bytes) throw new ProtocolError("invalid_content", "assembled size differs")
  return data
}
