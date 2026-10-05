import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils"
import type { Participant } from "./types.ts"

// The draw is reproducible: the same seed and the same field always give the same order,
// whatever order the entries were typed in. Each unseeded entry gets the key
// SHA-256("blueline-draw-v1" | seed | id) and the entries are sorted by it. A late entry
// therefore never reshuffles the others among themselves.
//
// The organizer can publish commitSeed(seed) before check-in closes and the seed itself at the
// draw; anyone can then check the commitment and recompute the pairings.

const hex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)))

export const commitSeed = (seed: string) => hex(`blueline-seed-v1\n${seed}`)

export const verifySeed = (seed: string, commitment: string) => commitSeed(seed) === commitment.toLowerCase()

// 128 random bits as hex, for a new tournament.
export function createDrawSeed() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export const drawKey = (seed: string, id: string) => hex(`blueline-draw-v1\n${seed}\n${id}`)

// The last tiebreak in tables: a lot that comes from the draw seed, fixed before anyone played.
export const lotKey = (seed: string, id: string) => hex(`blueline-lot-v1\n${seed}\n${id}`)

// Seed order after the draw: the first `seeded` entries keep their place, the rest follow in
// draw-key order.
export function drawOrder(participants: Participant[], seed: string, seeded = 0): Participant[] {
  const fixed = participants.slice(0, seeded)
  const drawn = participants
    .slice(seeded)
    .map((p) => ({ p, key: drawKey(seed, p.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ p }) => p)
  return [...fixed, ...drawn]
}

export const nextPowerOfTwo = (n: number) => {
  let size = 1
  while (size < n) size *= 2
  return size
}

// Standard bracket order for a power-of-two size: seed numbers by bracket position, so that
// position 2i plays 2i+1 in the first round. Seed s meets size+1-s first, 1 and 2 can only meet
// in the final, 1–4 not before the semi-finals. Byes (seeds above the field) fall to the top seeds.
//   2: 1 2   4: 1 4 2 3   8: 1 8 4 5 2 7 3 6
export function bracketOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const next = order.length * 2
    order = order.flatMap((s) => [s, next + 1 - s])
  }
  return order
}
