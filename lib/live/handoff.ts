import type { SavedMatch } from "../game/types.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { HandoffLink, HandoffMessage } from "../protocol/handoff.ts"
import { encodeHandoffLink, handoffPlaintext, handoffTemplate, MAX_HANDOFF_PACKAGE_BYTES, parseHandoffEvent } from "../protocol/handoff.ts"
import { MAX_HANDSHAKE_SECONDS } from "../protocol/kinds.ts"
import { packageHash, pairingCheckCode } from "../protocol/pairing.ts"
import { utf8Length } from "../protocol/schema.ts"
import { adoptBoard, handedOver, packBoard, seatInfo } from "./board.ts"
import { openChannel, repeat, type ChannelFlow } from "./channel.ts"
import { newKey, toHex } from "./keys.ts"

// "Auf anderem Gerät fortsetzen" (docs/protocol/families/session-authorization.md,
// "Schreiberwechsel"): the writing device shows a handoff code, the other device asks to take
// over, both show the same check code, and only the person at the writing device sends the match
// on its way. It stops writing once the other device confirmed it has the match; without that
// confirmation the game simply stays here. An offer can be called off (close) until the package
// is made; from then on the other device may have the match at any moment, so the screen keeps
// the offer open until "done" or the wait for it runs out.

const HANDOFF_FLOW: ChannelFlow<HandoffMessage> = { plaintext: handoffPlaintext, template: handoffTemplate, parse: parseHandoffEvent }

// How long the writing device waits for the other one to confirm the package.
const DELIVERY_WAIT_MS = 30_000

export type HandoffOffer =
  | { step: "waiting"; code: string; expires: number }
  | { step: "asked"; checkCode: string }
  | { step: "sending" }
  | { step: "done" }
  | { step: "failed"; reason: "expired" | "silent" | "too-long" }

export interface HandoffOfferControl {
  give: () => void
  decline: () => void
  close: () => void
}

export async function offerHandoff(local: string, onChange: (offer: HandoffOffer) => void): Promise<HandoffOfferControl> {
  const relays = seatInfo(local)?.relays
  if (!relays) throw new Error("the match is not live here")
  const key = await newKey()
  const sid = toHex(crypto.getRandomValues(new Uint8Array(16)))
  const expires = nowSeconds() + MAX_HANDSHAKE_SECONDS
  const code = encodeHandoffLink({ pubkey: key.pubkey, sid, expires, relays })
  let taker: string | null = null
  let sent: string | null = null
  let stopSending: (() => void) | null = null
  let waiting: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const set = (offer: HandoffOffer) => {
    if (!closed) onChange(offer)
  }
  const stop = () => {
    stopSending?.()
    stopSending = null
    clearTimeout(waiting)
  }
  const expiry = setTimeout(() => {
    if (!sent) set({ step: "failed", reason: "expired" })
  }, (expires - nowSeconds()) * 1000)

  const channel = openChannel(HANDOFF_FLOW, key, relays, (message, from) => {
    if (message.sid !== sid) return
    if (message.t === "take" && !taker && nowSeconds() <= expires) {
      taker = from
      set({ step: "asked", checkCode: pairingCheckCode(from, key.pubkey, sid) })
    } else if (message.t === "done" && from === taker && message.hash === sent) {
      stop()
      void handedOver(local).then(() => set({ step: "done" }))
    } else if (message.t === "abort" && from === taker && !sent) {
      taker = null
      set({ step: "waiting", code, expires })
    }
  })
  // Tells the asking device that the match stays here.
  const abort = (to: string) => channel.send(to, { t: "abort", sid, reason: "declined" }).catch(() => {})
  set({ step: "waiting", code, expires })

  return {
    give() {
      const to = taker
      if (!to || sent) return
      set({ step: "sending" })
      void packBoard(local).then(
        (data) => {
          // Called off while the package was being made: nothing has left this device.
          if (closed) return
          if (utf8Length(JSON.stringify(data)) > MAX_HANDOFF_PACKAGE_BYTES) return set({ step: "failed", reason: "too-long" })
          sent = packageHash(data)
          stopSending = repeat(() => channel.send(to, { t: "game", sid, data }))
          // No confirmation: the other device may not have it, so the game goes on here.
          waiting = setTimeout(() => {
            stop()
            sent = null
            set({ step: "failed", reason: "silent" })
          }, DELIVERY_WAIT_MS)
        },
        // The match stopped being live here meanwhile (another device took it): nothing to send.
        () => set({ step: "failed", reason: "silent" }),
      )
    },
    decline() {
      const to = taker
      if (!to || sent) return
      taker = null
      void abort(to)
      set({ step: "waiting", code, expires })
    },
    close() {
      closed = true
      // A device still asking hears that the match stays here. Once the package is on its way,
      // the other device may already have it: that is for the match itself to show (lib/live/
      // board.ts noticeTakeover), not for this offer.
      if (taker && !sent) void abort(taker)
      stop()
      clearTimeout(expiry)
      channel.close()
    },
  }
}

export type HandoffTake =
  | { step: "ready" }
  | { step: "asking"; checkCode: string }
  | { step: "declined" }
  | { step: "done"; game: SavedMatch }
  | { step: "failed"; reason: "expired" | "invalid" }

export interface HandoffTakeControl {
  take: () => void
  close: () => void
}

export function takeHandoff(link: HandoffLink, onChange: (take: HandoffTake) => void): HandoffTakeControl {
  let closed = false
  let stopAsking: (() => void) | null = null
  let adopted: { hash: string; game: SavedMatch } | null = null
  const set = (take: HandoffTake) => {
    if (!closed) onChange(take)
  }
  const keyed = newKey()
  const channel = keyed.then((key) =>
    openChannel(HANDOFF_FLOW, key, link.relays, (message, from) => {
      if (message.sid !== link.sid || from !== link.pubkey) return
      if (message.t === "game") void receive(message.data)
      else if (message.t === "abort" && !adopted) {
        stopAsking?.()
        set({ step: "declined" })
      }
    }),
  )
  const expiry = setTimeout(() => {
    stopAsking?.()
    if (!adopted) set({ step: "failed", reason: "expired" })
  }, Math.max(0, link.expires - nowSeconds()) * 1000)

  // The package may come again (the confirmation got lost, or it came while the first copy was
  // still being taken): it is taken once, confirmed each time.
  let adopting: Promise<void> | null = null
  async function receive(data: Record<string, unknown>) {
    stopAsking?.()
    const hash = packageHash(data)
    adopting ??= adopt(data, hash)
    await adopting
    if (adopted?.hash === hash) await (await channel).send(link.pubkey, { t: "done", sid: link.sid, hash }).catch(() => {})
  }
  async function adopt(data: Record<string, unknown>, hash: string) {
    const game = await adoptBoard(data)
    const current = await channel
    if (!game) {
      void current.send(link.pubkey, { t: "abort", sid: link.sid, reason: "error" }).catch(() => {})
      return set({ step: "failed", reason: "invalid" })
    }
    adopted = { hash, game }
    set({ step: "done", game })
  }

  if (link.expires <= nowSeconds()) set({ step: "failed", reason: "expired" })
  else set({ step: "ready" })

  return {
    take() {
      void channel.then((current) => {
        set({ step: "asking", checkCode: pairingCheckCode(current.key.pubkey, link.pubkey, link.sid) })
        stopAsking = repeat(() => current.send(link.pubkey, { t: "take", sid: link.sid }))
      })
    },
    close() {
      closed = true
      stopAsking?.()
      clearTimeout(expiry)
      void channel.then((current) => current.close())
    },
  }
}
