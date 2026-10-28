"use client"

import { useState } from "react"
import { Check, Clock, Ellipsis, UserRoundPlus } from "lucide-react"
import { Menu } from "@/components/ui/menu"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { friendsProblem } from "@/components/friends/problems"
import { useFriends } from "@/components/friends/use-friends"
import { findFriend } from "@/lib/friends/model"
import { acceptFriendRequest, removeFriendship, requestFriend } from "@/lib/friends/service"
import { useSession } from "@/lib/profile/session"
import type { SlotListProps } from "@/lib/shell/registry"

// On another player's profile: the friendship between you, as one button that says where it
// stands (Instagram, Strava: the follow button is the profile's own state). Nothing to ask →
// "Als Freund hinzufügen"; asked → "Anfrage gesendet" (tap to withdraw, asked once, not red:
// asking again is one tap); they asked → accept or decline, with the line they sent; friends →
// "Befreundet" with a check (tap to end it, asked once, red). Guests see nothing here.
const SECONDARY = "h-12 w-full gap-2 whitespace-normal rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"

type Asking = "remove" | "withdraw" | null

export default function FriendButton({ pubkey, name }: SlotListProps["profile.actions"]) {
  const tx = useAreaT(FRIENDS_TEXTS)
  const t = useT()
  const session = useSession()
  const { friends, loaded } = useFriends()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking>(null)
  if (!session || !loaded || session.pubkey === pubkey) return null
  const entry = friends ? findFriend(friends, pubkey) : null

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
    } catch (error) {
      setProblem(friendsProblem(tx, error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!entry && (
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => requestFriend(pubkey))} className={SECONDARY}>
          <UserRoundPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
          {tx.addFriend}
        </Button>
      )}
      {entry?.state === "sent" && (
        <Button variant="secondary" disabled={busy} onClick={() => setAsking("withdraw")} className={SECONDARY}>
          <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
          {tx.requestSent}
        </Button>
      )}
      {entry?.state === "received" && (
        <>
          <p className="px-1 text-[0.9375rem] leading-snug text-muted-foreground">{entry.message ? `${tx.wantsToBe}: „${entry.message}“` : tx.wantsToBe}</p>
          <Button disabled={busy} onClick={() => void run(() => acceptFriendRequest(pubkey))} className="h-12 w-full gap-2 whitespace-normal rounded-xl text-[1.0625rem] font-semibold">
            <UserRoundPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
            {tx.acceptRequest}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => removeFriendship(pubkey))} className="h-12 w-full rounded-xl text-[1.0625rem]">
            {tx.declineRequest}
          </Button>
        </>
      )}
      {entry?.state === "friend" && (
        <div className="flex min-h-11 items-center justify-between gap-2 px-1">
          <span className="flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
            <Check className="h-5 w-5 text-primary" aria-hidden="true" />{tx.friend}
          </span>
          <Menu icon={Ellipsis} label={t.shell.bar.more} items={[{ id: "remove", label: tx.removeConfirm, destructive: true, onSelect: () => setAsking("remove") }]} />
        </div>
      )}
      {problem && <InlineStatus tone="error">{problem}</InlineStatus>}
      <Confirm
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking === "withdraw" ? tx.withdrawTitle : tx.removeTitle(name)}
        text={asking === "withdraw" ? tx.withdrawText : tx.removeText}
        confirm={asking === "withdraw" ? tx.withdrawConfirm : tx.removeConfirm}
        destructive={asking === "remove"}
        onConfirm={() => {
          setAsking(null)
          void run(() => removeFriendship(pubkey))
        }}
      />
    </>
  )
}
