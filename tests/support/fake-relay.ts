// An in-memory relay network behind a fake WebSocket class, for unit tests of lib/nostr/client.ts
// without any process or port. Each URL gets a FakeRelay whose behaviour the test controls:
// reachable or not, silent, the reason in OK messages, CLOSED for some filters, NIP-42 AUTH.
// Real relay behaviour (nak serve) is covered by the tests in tests/relay/.
import { loadCore } from "../../lib/nostr/core.ts"
import type { Filter, NostrEvent } from "../../lib/nostr/types.ts"
import { verifyAuthEvent } from "nostr-core"

type Message = unknown[]

export interface FakeRelayOptions {
  // "down": every connection fails. "silent": connects, never answers anything.
  mode?: "up" | "down" | "silent"
  // The OK answer for an EVENT; default [true, ""] and the event is stored.
  onEvent?: (event: NostrEvent) => [boolean, string]
  // A CLOSED reason for a REQ, or null to serve it.
  onReq?: (filters: Filter[]) => string | null
  // Require NIP-42 AUTH for EVENT and REQ.
  auth?: boolean
}

export class FakeRelay {
  url: string
  events: NostrEvent[] = []
  options: FakeRelayOptions
  sockets = new Set<FakeSocket>()
  // Subscription ids open right now on each socket, and the most seen at once.
  maxOpenReqs = 0
  reqs: Filter[][] = []
  authed = new Set<FakeSocket>()
  authEvents: NostrEvent[] = []

  constructor(url: string, options: FakeRelayOptions = {}) {
    this.url = url
    this.options = options
  }

  // Drops every connection, as a relay restart or a network change would.
  dropAll() {
    for (const socket of [...this.sockets]) socket.serverClose()
  }

  async handle(socket: FakeSocket, message: Message) {
    const core = await loadCore()
    const mode = this.options.mode ?? "up"
    if (mode === "silent") return
    const [type] = message
    if (type === "EVENT") {
      const event = message[1] as NostrEvent
      if (this.options.auth && !this.authed.has(socket)) {
        socket.deliver(["AUTH", socket.challenge])
        return socket.deliver(["OK", event.id, false, "auth-required: please authenticate"])
      }
      const [ok, reason] = this.options.onEvent?.(event) ?? [true, ""]
      if (ok && !this.events.some((e) => e.id === event.id)) {
        this.events.push(event)
        for (const [subId, filters] of socket.subs) if (core.matchFilters(filters, event)) socket.deliver(["EVENT", subId, event])
        for (const other of this.sockets) {
          if (other === socket) continue
          for (const [subId, filters] of other.subs) if (core.matchFilters(filters, event)) other.deliver(["EVENT", subId, event])
        }
      }
      return socket.deliver(["OK", event.id, ok, reason])
    }
    if (type === "REQ") {
      const subId = message[1] as string
      const filters = message.slice(2) as Filter[]
      if (this.options.auth && !this.authed.has(socket)) {
        socket.deliver(["AUTH", socket.challenge])
        return socket.deliver(["CLOSED", subId, "auth-required: please authenticate"])
      }
      const refusal = this.options.onReq?.(filters) ?? null
      if (refusal) return socket.deliver(["CLOSED", subId, refusal])
      this.reqs.push(filters)
      socket.subs.set(subId, filters)
      this.maxOpenReqs = Math.max(this.maxOpenReqs, socket.subs.size)
      for (const event of this.events) if (core.matchFilters(filters, event)) socket.deliver(["EVENT", subId, event])
      return socket.deliver(["EOSE", subId])
    }
    if (type === "CLOSE") {
      socket.subs.delete(message[1] as string)
      return
    }
    if (type === "AUTH") {
      const event = message[1] as NostrEvent
      const valid = verifyAuthEvent(event, socket.challenge, event.tags.find((t) => t[0] === "relay")?.[1] ?? "")
      if (valid) {
        this.authed.add(socket)
        this.authEvents.push(event)
      }
      return socket.deliver(["OK", event.id, valid, valid ? "" : "invalid: bad auth"])
    }
  }
}

let socketSerial = 0

export class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  url: string
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  subs = new Map<string, Filter[]>()
  challenge = `challenge-${++socketSerial}`
  relay: FakeRelay | undefined

  constructor(url: string, network: FakeNetwork) {
    this.url = url
    this.relay = network.relayFor(url)
    setTimeout(() => {
      if (!this.relay || (this.relay.options.mode ?? "up") === "down") {
        this.readyState = 3
        this.onerror?.({})
        this.onclose?.({})
        return
      }
      this.readyState = 1
      this.relay.sockets.add(this)
      this.onopen?.({})
    }, 1)
  }

  send(data: string) {
    if (this.readyState !== 1) return
    const message = JSON.parse(data) as Message
    void this.relay?.handle(this, message)
  }

  deliver(message: Message) {
    if (this.readyState !== 1) return
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), 0)
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.relay?.sockets.delete(this)
    setTimeout(() => this.onclose?.({}), 0)
  }

  // The server side hangs up.
  serverClose() {
    this.relay?.authed.delete(this)
    this.close()
  }
}

export class FakeNetwork {
  relays = new Map<string, FakeRelay>()

  add(url: string, options: FakeRelayOptions = {}): FakeRelay {
    const relay = new FakeRelay(url, options)
    this.relays.set(normalize(url), relay)
    return relay
  }

  relayFor(url: string) {
    return this.relays.get(normalize(url))
  }

  // A WebSocket constructor bound to this network, for createRelayClient({ websocket }).
  get WebSocket(): typeof WebSocket {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const network = this
    class BoundSocket extends FakeSocket {
      constructor(url: string) {
        super(url, network)
      }
    }
    return BoundSocket as unknown as typeof WebSocket
  }
}

const normalize = (url: string) => url.replace(/\/+$/, "")
