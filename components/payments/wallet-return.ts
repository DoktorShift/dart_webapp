// "Wallet-App öffnen": a wallet app on this device creates the connection itself and opens
// BlueLine again (NWC deep links, NWC-07, a draft that nostr-core 1.0.4 doesn't cover). BlueLine
// opens nostrnwc://connect with its name, icon and a callback to /#wallet-return; the wallet adds
// the new connection as `value`. Added after the whole callback, it stays in the fragment and
// never reaches the web server; a wallet that puts it into the query instead sends it to the
// server's request log once (which wallets do what is unverified). Either way it is taken from the
// address at once and kept only in memory until the connect screen picks it up.

export function walletAppLink(origin: string): string {
  const params = new URLSearchParams({ appname: "BlueLine Darts", appicon: `${origin}/icon/192`, callback: `${origin}/#wallet-return` })
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

// Takes a wallet's answer: from the link's payload (after #wallet-return) or from the page's query.
// False when it carries no connection.
export function acceptWalletReturn(payload: string, search: string): boolean {
  returned = valueIn(payload) ?? valueIn(search)
  return returned !== null
}

// The connection a wallet app sent back, until it was tried (forgetReturnedConnection).
export const returnedConnection = () => returned

export function forgetReturnedConnection() {
  returned = null
}
