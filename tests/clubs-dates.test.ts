import { test } from "node:test"
import assert from "node:assert/strict"
import { repeatDates } from "../lib/clubs/dates.ts"

// Recurring club nights (lib/clubs/dates.ts): one date per evening at the same local time,
// also across the change of daylight-saving time.

process.env.TZ = "Europe/Berlin"

test("a weekly club night keeps its hour across the end of daylight-saving time", () => {
  // Wednesday 7 October 2026, 20:00 in Berlin (CEST); the clocks go back on 25 October.
  const first = Math.floor(new Date(2026, 9, 7, 20, 0).getTime() / 1000)
  const dates = repeatDates({ title: "Clubabend", starts: first, ends: first + 3 * 3600 }, 7, 4)
  assert.deepEqual(
    dates.map((d) => new Date(d.starts * 1000).getHours()),
    [20, 20, 20, 20],
  )
  assert.deepEqual(
    dates.map((d) => new Date(d.starts * 1000).getDate()),
    [7, 14, 21, 28],
  )
  assert.equal(new Date(dates[3].ends! * 1000).getHours(), 23)
  assert.equal(dates[3].starts - dates[2].starts, 7 * 86400 + 3600)
})
