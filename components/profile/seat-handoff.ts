import type { SetupSeat } from "@/lib/shell/registry"

// "Zum Spiel hinzufügen" on someone's profile: the seat they get in the game setup that opens
// next. Setup is a screen over all tabs, so the profile hands the seat over here and opens
// setup; setup's "setup.players" piece takes it the moment it shows (./setup-players.tsx).
// Nothing is stored: a seat not taken by the next setup is forgotten.

let offered: SetupSeat | null = null

export function offerSeat(seat: SetupSeat) {
  offered = seat
}

export function takeOfferedSeat(): SetupSeat | null {
  const seat = offered
  offered = null
  return seat
}
