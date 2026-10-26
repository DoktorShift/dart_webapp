"use client"

import { Users } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { FRIENDS_SCREENS } from "@/components/friends/screens"
import { useFriends } from "@/components/friends/use-friends"
import { byState } from "@/lib/friends/model"
import { useSession } from "@/lib/profile/session"

// The row "Freunde" in the Profile tab: how many, and how many requests wait for an answer.
export default function FriendsRow() {
  const tx = useAreaT(FRIENDS_TEXTS)
  const nav = useNav()
  const session = useSession()
  const { friends } = useFriends()
  if (!session) return null
  const count = friends ? byState(friends, "friend").length : 0
  const requests = friends ? byState(friends, "received").length : 0
  return <ListRow icon={Users} iconTone="teal" title={tx.row.title} subtitle={requests > 0 ? tx.row.requests(requests) : undefined} value={count > 0 ? count : undefined} onClick={() => nav.push(FRIENDS_SCREENS.list)} />
}
