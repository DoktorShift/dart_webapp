"use client"

import { ChevronRight, UserRoundPlus } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { FRIENDS_SCREENS } from "@/components/friends/screens"
import { useFriends } from "@/components/friends/use-friends"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState } from "@/lib/friends/model"

const FACES = 3

// The friends line on the own profile card ("profile.card"), where Strava and Duolingo put the
// people of a profile: the first faces, how many, and the requests waiting, one tappable line
// under the figures that opens the list. With nobody yet it says "Freunde hinzufügen" and opens
// the list with the sheet that adds one. Nothing on another person's card: the button there
// says the relationship.
export default function FriendsProfileLine({ own }: { pubkey: string; own: boolean }) {
  const tx = useAreaT(FRIENDS_TEXTS)
  const nav = useNav()
  const { friends, loaded } = useFriends()
  const list = friends ? byState(friends, "friend") : []
  const faces = list.slice(0, FACES)
  const names = useProfileNames(faces.map((f) => f.pubkey))
  if (!own || !loaded) return null
  const requests = friends ? byState(friends, "received").length : 0
  // Until this device knows the list, the line is the plain word: the entry is never missing.
  const nobody = !!friends && list.length === 0 && requests === 0
  const text = !friends ? tx.title : nobody ? tx.card.add : tx.card.count(list.length)
  return (
    <button
      type="button"
      onClick={() => nav.push(FRIENDS_SCREENS.list, nobody ? { add: "1" } : undefined)}
      className="-mx-2 -my-1 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-secondary/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {faces.length > 0 ? (
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {faces.map((f, i) => (
            <Avatar key={f.pubkey} seed={f.pubkey} name={names(f.pubkey).name ?? undefined} src={names(f.pubkey).picture} size={28} className={i > 0 ? "-ml-2 ring-2 ring-card" : "ring-2 ring-card"} />
          ))}
        </span>
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground" aria-hidden="true">
          <UserRoundPlus className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug wrap-anywhere">
        {text}
        {requests > 0 && <span className="font-semibold text-primary"> · {tx.card.requests(requests)}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  )
}
