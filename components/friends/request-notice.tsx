"use client"

import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { FRIENDS_SCREENS } from "@/components/friends/screens"
import { friendsProblem } from "@/components/friends/problems"
import { useFriends } from "@/components/friends/use-friends"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState, type FriendEntry } from "@/lib/friends/model"
import { acceptFriendRequest } from "@/lib/friends/service"
import { SCREENS } from "@/lib/shell/registry"

const SHOWN = 2

// Requests waiting for an answer, as cards under the own profile's sports card
// ("profile.notices"), the way Fitness surfaces a sharing invitation: who asks, their line, and
// "Annehmen" right there. The person's name opens their profile, where the request is declined.
// Two at most; the rest wait in the list, which the line on the card counts.
export default function FriendRequestNotices() {
  const tx = useAreaT(FRIENDS_TEXTS)
  const nav = useNav()
  const { friends } = useFriends()
  const received = friends ? byState(friends, "received") : []
  const shown = received.slice(0, SHOWN)
  const names = useProfileNames(shown.map((f) => f.pubkey))
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (shown.length === 0) return null

  const nameOf = (pubkey: string) => names(pubkey).name ?? tx.unnamed
  const accept = async (f: FriendEntry) => {
    setBusy(f.pubkey)
    setProblem(null)
    try {
      await acceptFriendRequest(f.pubkey)
    } catch (error) {
      setProblem(friendsProblem(tx, error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {shown.map((f) => (
        <div key={f.pubkey} className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card py-2 pl-3 pr-3">
          <button
            type="button"
            onClick={() => nav.push(SCREENS.profilePublic, { pubkey: f.pubkey })}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar seed={f.pubkey} name={nameOf(f.pubkey)} src={names(f.pubkey).picture} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-semibold leading-snug wrap-anywhere">{tx.notice.wants(nameOf(f.pubkey))}</span>
              {f.message && <span className="block text-[0.875rem] leading-snug text-muted-foreground wrap-anywhere">„{f.message}“</span>}
            </span>
          </button>
          <Button onClick={() => void accept(f)} disabled={busy !== null} aria-label={tx.notice.acceptFor(nameOf(f.pubkey))} className="h-11 shrink-0 rounded-full px-4 text-[0.9375rem] font-semibold">
            {busy === f.pubkey ? tx.accepting : tx.accept}
          </Button>
        </div>
      ))}
      {received.length > SHOWN && (
        <button type="button" onClick={() => nav.push(FRIENDS_SCREENS.list)} className="mt-1 flex min-h-11 w-full items-center justify-center rounded-xl text-[1.0625rem] font-semibold text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          {tx.notice.more(received.length - SHOWN)}
        </button>
      )}
      {problem && (
        <InlineStatus tone="error" className="mt-2">
          {problem}
        </InlineStatus>
      )}
    </>
  )
}
