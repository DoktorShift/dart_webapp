import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { base64urlnopad } from "@scure/base"
import { ProtocolError } from "./reasons.ts"
import { HEX32, HEX64 } from "./tags.ts"

// Payloads of BlueLine links and QR codes (docs/protocol/families/pairing.md, board-join.md,
// session-authorization.md).
// Links point at "/" and carry everything in the fragment ("#pair=…"), which browsers never
// send to a server. Each payload starts with its own type letter and format version, so a
// payload pasted under the wrong key, or a board QR scanned where a pairing QR is expected,
// is refused before anything else happens:
//
//   #pair=P1.<one-time pubkey>.<session id>.<expiry>.<relays>
//   #board=B1.<one-time pubkey>.<session id>.<expiry>.<relays>
//   #handoff=H1.<one-time pubkey>.<session id>.<expiry>.<relays>
//   #watch=W1.<match id>.<match key secret or empty>.<relays>
//   #club=C1.<club id>.<invite event id>.<invite token>.<relays>   (invite parts may be empty)
//   #tournament=T1.<tournament id>.<relays>
//   #tournament=TB1.<tournament id>.<board id>.<board key secret>.<relays>   (board authorization)
//   #p=U1.<pubkey>.<relays>
//
// 32- and 16-byte values are base64url without padding, the expiry is unix seconds in base 36,
// relays are comma-separated with "wss://" left out. Relays come last because hosts contain dots.
// The secrets a link may carry (match key of a private match, invite token, a board's key) are
// bearer secrets: whoever has the link can watch, join and read the invite's preview, or act as
// that board of the tournament (docs/protocol/privacy.md, families/tournament.md "Boards").
// Two payload types may share a fragment key (a tournament's link and its board authorization):
// the prefix tells them apart, so a board code never opens as an ordinary tournament link.

export type LinkPayload =
  | { type: "pair"; pubkey: string; sid: string; expires: number; relays: string[] }
  | { type: "board"; pubkey: string; sid: string; expires: number; relays: string[] }
  | { type: "handoff"; pubkey: string; sid: string; expires: number; relays: string[] }
  | { type: "watch"; match: string; key?: string; relays: string[] }
  | { type: "club"; club: string; invite?: string; token?: string; relays: string[] }
  | { type: "tournament"; tournament: string; relays: string[] }
  // The organizer's authorization of one board device: its id and the secret of the key named in
  // the tournament.board record, shown once as a QR code to the device that becomes the board.
  | { type: "tournamentBoard"; tournament: string; board: string; key: string; relays: string[] }
  | { type: "profile"; pubkey: string; relays: string[] }

export type LinkType = LinkPayload["type"]

const PREFIX: Record<LinkType, string> = { pair: "P1", board: "B1", handoff: "H1", watch: "W1", club: "C1", tournament: "T1", tournamentBoard: "TB1", profile: "U1" }
const FRAGMENT_KEY: Record<LinkType, string> = { pair: "pair", board: "board", handoff: "handoff", watch: "watch", club: "club", tournament: "tournament", tournamentBoard: "tournament", profile: "p" }
// Fields before the relays, per type.
const FIELDS: Record<LinkType, number> = { pair: 3, board: 3, handoff: 3, watch: 2, club: 3, tournament: 1, tournamentBoard: 3, profile: 1 }

export const MAX_LINK_RELAYS = 4

const bad = (detail: string) => new ProtocolError("invalid_content", detail)

const b64 = (hex: string, bytes: number) => {
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(hex)) throw bad(`expected ${bytes} bytes of hex`)
  return base64urlnopad.encode(hexToBytes(hex))
}

const unb64 = (text: string, bytes: number) => {
  let raw: Uint8Array
  try {
    raw = base64urlnopad.decode(text)
  } catch {
    throw bad("not base64url")
  }
  if (raw.length !== bytes) throw bad(`expected ${bytes} bytes`)
  return bytesToHex(raw)
}

const opt = (value: string | undefined, bytes: number) => (value === undefined ? "" : b64(value, bytes))
const unopt = (text: string, bytes: number) => (text === "" ? undefined : unb64(text, bytes))

function encodeRelays(relays: readonly string[]) {
  if (relays.length > MAX_LINK_RELAYS) throw bad(`at most ${MAX_LINK_RELAYS} relays`)
  return relays
    .map((r) => {
      if (!/^wss?:\/\/[^\s,#"<>\\]+$/.test(r)) throw bad(`relay ${r}`)
      return r.startsWith("wss://") ? r.slice(6) : r
    })
    .join(",")
}

function decodeRelays(text: string) {
  if (text === "") return []
  const relays = text.split(",").map((r) => (r.includes("://") ? r : `wss://${r}`))
  if (relays.length > MAX_LINK_RELAYS) throw bad(`at most ${MAX_LINK_RELAYS} relays`)
  for (const r of relays) if (!/^wss?:\/\/[^\s,#"<>\\/][^\s,#"<>\\]*$/.test(r)) throw bad(`relay ${r}`)
  return relays
}

const encodeTime = (t: number) => {
  if (!Number.isSafeInteger(t) || t < 0) throw bad("expiry")
  return t.toString(36)
}

const decodeTime = (text: string) => {
  if (!/^[0-9a-z]{1,8}$/.test(text)) throw bad("expiry")
  return parseInt(text, 36)
}

export function encodeLinkPayload(p: LinkPayload): string {
  let fields: string[]
  switch (p.type) {
    case "pair":
    case "board":
    case "handoff":
      if (!HEX32.test(p.sid)) throw bad("session id")
      fields = [b64(p.pubkey, 32), b64(p.sid, 16), encodeTime(p.expires)]
      break
    case "watch":
      fields = [b64(p.match, 32), opt(p.key, 32)]
      break
    case "club":
      if ((p.invite === undefined) !== (p.token === undefined)) throw bad("invite id and token go together")
      fields = [b64(p.club, 32), opt(p.invite, 32), opt(p.token, 16)]
      break
    case "tournament":
      fields = [b64(p.tournament, 32)]
      break
    case "tournamentBoard":
      fields = [b64(p.tournament, 32), b64(p.board, 16), b64(p.key, 32)]
      break
    case "profile":
      fields = [b64(p.pubkey, 32)]
      break
  }
  return [PREFIX[p.type], ...fields, encodeRelays(p.relays)].join(".")
}

// Decodes a payload that must be of `expected` type. Anything else, including a valid payload
// of another type, is refused with "wrong_flow".
export function decodeLinkPayload<T extends LinkType>(expected: T, text: string): Extract<LinkPayload, { type: T }> {
  const own = `${PREFIX[expected]}.`
  if (!text.startsWith(own)) {
    const other = (Object.keys(PREFIX) as LinkType[]).find((k) => text.startsWith(`${PREFIX[k]}.`))
    throw new ProtocolError("wrong_flow", other ? `a ${other} code, not a ${expected} code` : "not a BlueLine code")
  }
  const parts = text.slice(own.length).split(".")
  const n = FIELDS[expected]
  if (parts.length < n + 1) throw bad("fields missing")
  const fields = parts.slice(0, n)
  const relays = decodeRelays(parts.slice(n).join("."))

  let payload: LinkPayload
  switch (expected) {
    case "pair":
    case "board":
    case "handoff":
      payload = { type: expected, pubkey: unb64(fields[0], 32), sid: unb64(fields[1], 16), expires: decodeTime(fields[2]), relays }
      break
    case "watch": {
      const key = unopt(fields[1], 32)
      payload = { type: "watch", match: unb64(fields[0], 32), ...(key ? { key } : {}), relays }
      break
    }
    case "club": {
      const invite = unopt(fields[1], 32)
      const token = unopt(fields[2], 16)
      if ((invite === undefined) !== (token === undefined)) throw bad("invite id and token go together")
      payload = { type: "club", club: unb64(fields[0], 32), ...(invite ? { invite } : {}), ...(token ? { token } : {}), relays }
      break
    }
    case "tournament":
      payload = { type: "tournament", tournament: unb64(fields[0], 32), relays }
      break
    case "tournamentBoard":
      payload = { type: "tournamentBoard", tournament: unb64(fields[0], 32), board: unb64(fields[1], 16), key: unb64(fields[2], 32), relays }
      break
    default:
      payload = { type: "profile", pubkey: unb64(fields[0], 32), relays }
  }
  if ("pubkey" in payload && !HEX64.test(payload.pubkey)) throw bad("pubkey")
  return payload as Extract<LinkPayload, { type: T }>
}

export const linkFragment = (p: LinkPayload) => `#${FRAGMENT_KEY[p.type]}=${encodeLinkPayload(p)}`

// The fragment of an opened link ("#watch=W1.…"), checked against the key it came under.
export function parseLinkFragment(hash: string): LinkPayload {
  const m = /^#?([a-z]+)=(.+)$/.exec(hash)
  if (!m) throw new ProtocolError("wrong_flow", "not a BlueLine link")
  const types = (Object.keys(FRAGMENT_KEY) as LinkType[]).filter((k) => FRAGMENT_KEY[k] === m[1])
  if (types.length === 0) throw new ProtocolError("wrong_flow", "not a BlueLine link")
  let value: string
  try {
    value = decodeURIComponent(m[2])
  } catch {
    throw bad("damaged link")
  }
  // Types sharing the key: the one whose prefix the payload carries, else the first one's refusal.
  return decodeLinkPayload(types.find((k) => value.startsWith(`${PREFIX[k]}.`)) ?? types[0], value)
}
