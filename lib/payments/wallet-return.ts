// "Wallet-App öffnen": a wallet app on this device creates the connection itself and opens
// BlueLine again (NWC deep links, NWC-07, a draft that nostr-core 1.0.4 doesn't cover). BlueLine
// opens nostrnwc://connect with its name, icon and a callback to /#wallet-return=<request>; the
// wallet adds the new connection as `value`. Added after the whole callback, it stays in the
// fragment and never reaches the web server; a wallet that puts it into the query instead sends
// it to the server's request log once (which wallets do what is unverified). Either way it is
// taken from the address at once and kept only in memory until the connect screen picks it up.
//
// Only the answer to a request this device made counts. Opening the wallet app notes a random
// request id with the time, and the answer must bring it back within REQUEST_TTL_MS. The first
// answer uses the request up, so a link sent by someone else, or one seen before and opened again,
// is refused. Even a requested connection is kept only after the person confirmed it
// (components/payments/connect.tsx). The request is in localStorage: written at once, before the
// wallet app opens, and readable by a new tab the wallet may open the answer in.
import { randomHex } from "../storage/ids.ts"

const REQUEST_KEY = "blueline.wallet-request"
// Long enough to set up a connection in the wallet app.
const REQUEST_TTL_MS = 10 * 60_000
const REQUEST_ID = /^[0-9a-f]{32}/

interface WalletRequest {
  id: string
  at: number
}

function readRequest(): WalletRequest | null {
  try {
    const request = JSON.parse(window.localStorage.getItem(REQUEST_KEY) ?? "null") as Partial<WalletRequest> | null
    return typeof request?.id === "string" && typeof request.at === "number" ? { id: request.id, at: request.at } : null
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

// The link that opens a wallet app, as a new request. Without storage the answer can't be
// matched and is refused: the person pastes the connection instead.
export function walletAppLink(origin: string, now = Date.now()): string {
  const id = randomHex(16)
  try {
    window.localStorage.setItem(REQUEST_KEY, JSON.stringify({ id, at: now } satisfies WalletRequest))
  } catch {
    // See above.
  }
  const params = new URLSearchParams({ appname: "BlueLine Darts", appicon: `${origin}/icon/192`, callback: `${origin}/#wallet-return=${id}` })
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

let returned: string | null = null

// Takes a wallet app's answer: the link's payload ("<request>?value=…") and the page's query (a
// wallet may put the value there). "connection": an answer to this device's open request, held
// for the connect screen. "unrequested": a connection nobody asked for here, not taken. Null when
// the answer carries no connection (the person cancelled in the wallet app).
export function acceptWalletReturn(payload: string, search: string, now = Date.now()): "connection" | "unrequested" | null {
  const value = valueIn(payload) ?? valueIn(search)
  if (!value) return null
  const request = readRequest()
  const id = REQUEST_ID.exec(payload)?.[0]
  if (!request || id !== request.id || now - request.at > REQUEST_TTL_MS) return "unrequested"
  forgetRequest()
  returned = value
  return "connection"
}

// The connection a wallet app sent back, until it was confirmed or dismissed.
export const returnedConnection = () => returned

export function forgetReturnedConnection() {
  returned = null
}
