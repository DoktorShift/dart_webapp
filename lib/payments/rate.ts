// The price of a bitcoin in the person's currency (decision 0001 F4: nostr-core's public rate
// service, never a service of BlueLine's own). Asked at most once a minute, and only while a
// payments screen is shown; the last answer is kept on the device ("payments.rate" in kv) so
// amounts have a fiat side at once, also without a connection, said with the time of the rate.
// The rate is never in a backup or export. Without any rate, amounts show in bitcoin only.
import { exchangeRate } from "../nostr/wallet.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { RATE_FRESH_MS, isCurrency, type Currency, type Rate } from "./money.ts"

const KEY = "payments.rate"

type Stored = Partial<Record<Currency, Rate>>
type Fetcher = (currency: string) => Promise<{ rate: number; at: number }>

const known = new Map<Currency, Rate>()
const listeners = new Set<() => void>()
let read: Promise<void> | null = null
const fetching = new Map<Currency, Promise<void>>()

const notify = () => listeners.forEach((listener) => listener())

// Reads the stored rates once per page load.
function readStored(): Promise<void> {
  return (read ??= kvGet<Stored>(KEY)
    .then((stored) => {
      let added = false
      for (const [currency, rate] of Object.entries(stored ?? {})) {
        if (isCurrency(currency) && rate && typeof rate.rate === "number" && typeof rate.at === "number" && !known.has(currency)) {
          known.set(currency, { ...rate, currency })
          added = true
        }
      }
      if (added) notify()
    })
    .catch(() => {}))
}

// The rate known now (memory, then the device), null without one.
export async function loadRate(currency: Currency): Promise<Rate | null> {
  await readStored()
  return known.get(currency) ?? null
}

export const peekRate = (currency: Currency): Rate | null => known.get(currency) ?? null

// Fetches a fresh rate unless the known one is fresh enough; a failed fetch changes nothing.
export async function refreshRate(currency: Currency, options: { fetcher?: Fetcher; now?: () => number } = {}): Promise<Rate | null> {
  const now = options.now ?? Date.now
  await readStored()
  const current = known.get(currency)
  if (current && now() - current.at < RATE_FRESH_MS) return current
  let running = fetching.get(currency)
  if (!running) {
    const fetcher = options.fetcher ?? exchangeRate
    running = fetcher(currency.toLowerCase())
      .then(async ({ rate, at }) => {
        if (!(rate > 0)) return
        known.set(currency, { rate, at, currency })
        notify()
        await kvSet(KEY, Object.fromEntries(known)).catch(() => {})
      })
      .catch(() => {})
      .finally(() => {
        fetching.delete(currency)
      })
    fetching.set(currency, running)
  }
  await running
  return known.get(currency) ?? null
}

export function subscribeRate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// For tests: forget everything read or fetched.
export function resetRates() {
  known.clear()
  read = null
  fetching.clear()
}
