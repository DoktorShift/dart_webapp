import { generalRelays } from "../nostr/relays.ts"
import { encodeLinkPayload, MAX_LINK_RELAYS } from "../protocol/links.ts"
import { buildLink } from "../shell/links.ts"

// The links and QR codes of a tournament (lib/protocol/links.ts): the tournament itself, to
// register or watch, and the organizer's code that makes a device one of its boards. Each
// names the relays the tournament travels on, so the link alone is enough to find it.

const linkRelays = (hints: readonly string[]) => [...new Set([...hints, ...generalRelays()])].slice(0, MAX_LINK_RELAYS)

export const tournamentLink = (site: string, tournament: string, hints: readonly string[] = []) =>
  buildLink(site, "tournament", encodeLinkPayload({ type: "tournament", tournament, relays: linkRelays(hints) }))

export const boardLink = (site: string, payload: { tournament: string; board: string; key: string }, hints: readonly string[] = []) =>
  buildLink(site, "tournament", encodeLinkPayload({ type: "tournamentBoard", ...payload, relays: linkRelays(hints) }))
