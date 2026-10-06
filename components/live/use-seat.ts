"use client"

import { useEffect, useState } from "react"
import { useFollowed } from "@/components/live/match-view"
import { holdsSeat, keepConfirmed, type JoinedMatch } from "@/lib/live/join"
import { toHex } from "@/lib/live/keys"

// A seat this phone holds, followed from the relays: the player's own games follow the result
// they confirmed (lib/live/join.ts keepConfirmed), and `lost` says the seat is no longer this
// phone's. The board's answer is proof enough for a seat given just now; the match shows it a
// moment later. A seat restored from memory counts only once the match shows this phone's key
// on it: the board's "taken" says nothing about whose it is. Either way, the seat is lost once
// the relays have told everything and the key on it is not this phone's.
export function useSeat(initial: JoinedMatch, restored: boolean) {
  const [joined, setJoined] = useState(initial)
  const followed = useFollowed({ match: joined.match, key: joined.key ? toHex(joined.key.secret) : null, relays: joined.relays })
  const state = followed.state

  useEffect(() => {
    if (state) void keepConfirmed(joined, state).then(setJoined, () => {})
  }, [state, joined])

  const holds = state !== null && holdsSeat(joined, state)
  const [held, setHeld] = useState(restored)
  if (holds && !held) setHeld(true)
  const lost = followed.settled && held && state !== null && !holds
  return { joined, followed, lost }
}
