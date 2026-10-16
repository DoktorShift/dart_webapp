"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import { EarnedRow, useReached } from "@/components/badges/earned-row"
import { useSession } from "@/lib/profile/session"
import type { SlotListProps } from "@/lib/shell/registry"

// The success card on the result of a finished game (registry "result.actions"): one quiet row
// naming what this game made a player reach, worked out from the archive once the game is in it
// (PLAN.md "Auszeichnungen": a small card that can be put away, never interrupting the game).
// A tap shows the badges; a signed-in player can show their own in their profile from there.
// Nothing is published on its own, and a guest's milestones stay "Auf diesem Gerät erreicht".
// The row is the result's shared ResultRow in the warning tone (something worth a look), which
// carries the sizes and placements the result asks of its pieces.
//
// A guest's result loads the milestones and nothing else; the profile's part (its badges, own
// events, publishing) loads only with a session.

const ProfileEarned = lazyScreen<SlotListProps["result.actions"]>(() => import("@/components/badges/earned-profile"))

export default function EarnedCard(props: SlotListProps["result.actions"]) {
  const session = useSession()
  if (session === undefined) return null
  return session ? <ProfileEarned {...props} /> : <GuestEarned {...props} />
}

function GuestEarned(props: SlotListProps["result.actions"]) {
  return <EarnedRow {...props} reached={useReached(props.match, null)} />
}
