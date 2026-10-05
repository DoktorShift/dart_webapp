// The clock for created_at. Relays reject events too far in the future (strfry: 900 s), so a
// device whose clock runs fast would have every event refused. The offset corrects the device
// clock once a trustworthy time is known; every created_at the app signs comes from here.
// No dependencies, so the generic modules in ./ext can use it too.

let clockOffsetSeconds = 0
// Below this, a difference is noise (HTTP dates have one-second resolution, caches add age).
const CLOCK_TOLERANCE_SECONDS = 30
// Never sign further ahead of corrected time than this, whatever a previous version says.
const MAX_AHEAD_SECONDS = 600

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000) + clockOffsetSeconds
}

export function clockOffset(): number {
  return clockOffsetSeconds
}

// Learns the device clock's error from a server's Date header (for example the app's own origin).
export function adjustClock(serverDate: string | number | Date, receivedAtMs = Date.now()) {
  const server = new Date(serverDate).getTime()
  if (!Number.isFinite(server)) return
  const offset = Math.round((server - receivedAtMs) / 1000)
  clockOffsetSeconds = Math.abs(offset) > CLOCK_TOLERANCE_SECONDS ? offset : 0
}

// Asks the app's own origin for the time (a HEAD request, no data). Only call it on paths that
// go online anyway, never on the guest path.
export async function syncClock(origin = typeof location !== "undefined" ? location.origin : ""): Promise<boolean> {
  if (!origin) return false
  try {
    const response = await fetch(`${origin}/`, { method: "HEAD", cache: "no-store" })
    const date = response.headers.get("date")
    if (!date) return false
    adjustClock(date)
    return true
  } catch {
    return false
  }
}

// created_at for a new event. Pass the created_at of the version it replaces, so a replaceable
// update always wins over it, as far as a clock relays still accept allows.
export function createdAt(replaces?: number): number {
  const now = nowSeconds()
  if (replaces === undefined || replaces < now) return now
  return Math.min(replaces + 1, now + MAX_AHEAD_SECONDS)
}
