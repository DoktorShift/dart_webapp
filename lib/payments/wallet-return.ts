// "Wallet-App öffnen": a wallet app on this device creates the connection itself and opens
// BlueLine again (NWC deep links, NWC-07, a draft that nostr-core 1.0.4 doesn't cover). BlueLine
// opens nostrnwc://connect with its name, icon and a callback to /#wallet-return=<request>; the
// wallet adds the new connection as `value`. Added after the whole callback, it stays in the
// fragment and never reaches the web server; a wallet that puts it into the query instead sends
// it to the server's request log once (which wallets do what is unverified). Either way it is
// taken from the address at once and kept only in memory until a connect panel has shown it.
//
// Only the answer to a request this device made counts. Opening the wallet app notes a random
// request id with the time, and the answer must bring it back within REQUEST_TTL_MS. The first
// answer uses the request up, so a link sent by someone else, or one seen before and opened again,
// is refused. Even a requested connection is kept only after the person confirmed it
// (components/payments/connect.tsx). The request is in localStorage: written at once, before the
// wallet app opens, and readable by a new tab the wallet may open the answer in.
//
// The request also notes where it was made, so the answer goes back there: the payment sheet on
// a game's result opens again with it (also after a fresh page load, which restores the game);
// anything else is shown by the connect screen (components/payments/register.ts).
import { randomHex } from "../storage/ids.ts"

const REQUEST_KEY = "blueline.wallet-request"
// Long enough to set up a connection in the wallet app.
const REQUEST_TTL_MS = 10 * 60_000
const REQUEST_ID = /^[0-9a-f]{32}/

// Where "Wallet-App öffnen" was tapped: the payment sheet of the game `match`, on the side it
// was open for.
export interface RequestOrigin {
  match: string
  side?: "pay" | "receive"
}

interface WalletRequest {
  id: string
  at: number
  from?: RequestOrigin
}

function originOf(value: unknown): RequestOrigin | undefined {
  const from = value as Partial<RequestOrigin> | null | undefined
  if (typeof from?.match !== "string") return undefined
  return from.side === "pay" || from.side === "receive" ? { match: from.match, side: from.side } : { match: from.match }
}

function readRequest(): WalletRequest | null {
  try {
    const request = JSON.parse(window.localStorage.getItem(REQUEST_KEY) ?? "null") as Partial<WalletRequest> | null
    if (typeof request?.id !== "string" || typeof request.at !== "number") return null
    return { id: request.id, at: request.at, from: originOf(request.from) }
  } catch {
    return null
  }
}

function forgetRequest() {
  try {
    window.localStorage.removeItem(REQUEST_KEY)
  } catch {
    // Nothing kept.
  }
}

// The link that opens a wallet app, as a new request made at `from` (null: the connect screen).
// Without storage the answer can't be matched and is refused: the person pastes the connection
// instead.
export function walletAppLink(site: string, from: RequestOrigin | null, now = Date.now()): string {
  const id = randomHex(16)
  try {
    window.localStorage.setItem(REQUEST_KEY, JSON.stringify({ id, at: now, ...(from ? { from } : {}) } satisfies WalletRequest))
  } catch {
    // See above.
  }
  const params = new URLSearchParams({ appname: "BlueLine Darts", appicon: `${site}/icon/192`, callback: `${site}/#wallet-return=${id}` })
  return `nostrnwc://connect?${params}`
}

// `value` from a query string, percent-decoded; a "+" stays a "+" (nostr+walletconnect).
function valueIn(query: string): string | null {
  const match = /(?:^|[?&])value=([^&#]*)/.exec(query)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]) || null
  } catch {
    return null
  }
}

// The connection a wallet app sent back, and where it was asked for.
export interface ReturnedConnection {
  uri: string
  from: RequestOrigin | null
}

let returned: ReturnedConnection | null = null
const listeners = new Set<() => void>()

function setReturned(next: ReturnedConnection | null) {
  if (next === returned) return
  returned = next
  for (const listener of listeners) listener()
}

// Takes a wallet app's answer: the link's payload ("<request>?value=…") and the page's query (a
// wallet may put the value there). "connection": an answer to this device's open request, held
// until a connect panel has shown it. "unrequested": a connection nobody asked for here, not
// taken. Null when the answer carries no connection (the person cancelled in the wallet app).
export function acceptWalletReturn(payload: string, search: string, now = Date.now()): "connection" | "unrequested" | null {
  const value = valueIn(payload) ?? valueIn(search)
  if (!value) return null
  const request = readRequest()
  const id = REQUEST_ID.exec(payload)?.[0]
  if (!request || id !== request.id || now - request.at > REQUEST_TTL_MS) return "unrequested"
  forgetRequest()
  setReturned({ uri: value, from: request.from ?? null })
  return "connection"
}

// The answer held right now, until it was confirmed or dismissed; `subscribeReturned` tells when
// it changes.
export const returnedConnection = (): ReturnedConnection | null => returned

export function subscribeReturned(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function forgetReturnedConnection() {
  setReturned(null)
}

// A connect panel on screen shows the answer by itself while it is mounted, so nothing else needs
// to be opened for it. Returns the function that ends the watch.
let watching = 0

export function watchReturns(): () => void {
  watching += 1
  return () => {
    watching -= 1
  }
}

export const returnsWatched = (): boolean => watching > 0
