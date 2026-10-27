"use client"

import { CountBadge } from "@/components/ui/count-badge"
import { useAreaT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { useFriends } from "@/components/friends/use-friends"
import { byState } from "@/lib/friends/model"
import type { TabId } from "@/lib/shell/nav"

// The requests waiting for an answer, on the Profile tab's symbol: the person sees them from any
// tab, as a tab bar badge is meant to be seen.
export default function FriendsTabBadge({ tab, id }: { tab: TabId; id: string }) {
  const tx = useAreaT(FRIENDS_TEXTS)
  const { friends } = useFriends()
  if (tab !== "profile" || !friends) return null
  const requests = byState(friends, "received").length
  return <CountBadge count={requests} label={tx.card.requests(requests)} id={id} />
}
