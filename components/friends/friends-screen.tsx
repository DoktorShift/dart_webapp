"use client"

import { useMemo, useState } from "react"
import { UserRoundPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { InlineStatus } from "@/components/common/inline-status"
import { PersonRow } from "@/components/common/person-row"
import { NavBarItems, NavIconButton } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { AddFriendSheet } from "@/components/friends/add-friend-sheet"
import { friendsProblem } from "@/components/friends/problems"
import { useFriends } from "@/components/friends/use-friends"
import { ShareSheet } from "@/components/profile/share-sheet"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState, type FriendEntry } from "@/lib/friends/model"
import { acceptFriendRequest } from "@/lib/friends/service"
import { formatDate } from "@/lib/i18n"
import { useMatchHistory } from "@/lib/leaderboard"
import { recentPlayers } from "@/lib/profile/recent-players"
import { ownRelaySettings } from "@/lib/profile/own-events"
import { useSession } from "@/lib/profile/session"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// Profil › Freunde: requests to answer first (Game Center lists them on top), then the friends
// with the games played together here, then one's own requests on their way. Every row opens the
// person's profile, where the friendship is declined, withdrawn or ended; "Annehmen" sits in the
// row. "Freund hinzufügen" is the bar's button, as adding a contact is (opened at once with
// params.add, from the card of a profile without friends); it waits while the device can't keep
// the list yet.
export default function FriendsScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(FRIENDS_TEXTS)
  const nav = useNav()
  const session = useSession()
  const own = useOwnProfile()
  const { friends, loaded, available, state } = useFriends()
  const received = friends ? byState(friends, "received") : []
  const current = friends ? byState(friends, "friend") : []
  const sent = friends ? byState(friends, "sent") : []
  const names = useProfileNames([...received, ...current, ...sent].map((f) => f.pubkey))
  const { all: matches } = useMatchHistory()
  const me = session?.pubkey ?? null
  const together = useMemo(() => new Map(recentPlayers(matches, me, { withProfile: true, limit: Infinity }).map((p) => [p.pubkey, p])), [matches, me])
  const [addOpen, setAddOpen] = useState(params.add === "1")
  const [codeOpen, setCodeOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (!loaded || !session) return null

  const canAdd = available !== false
  const open = (f: FriendEntry) => nav.push(SCREENS.profilePublic, { pubkey: f.pubkey })
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
  const empty = received.length + current.length + sent.length === 0
  const lineOf = (f: FriendEntry) => {
    const played = together.get(f.pubkey)
    return played ? tx.together(played.games, formatDate(t, Date.parse(played.playedAt))) : tx.since(formatDate(t, f.since * 1000))
  }

  return (
    <>
      <NavBarItems>{canAdd && <NavIconButton icon={UserRoundPlus} label={tx.add} onClick={() => setAddOpen(true)} className="-mr-1" />}</NavBarItems>

      {available === false && <InlineStatus className="mt-4">{tx.unavailable}</InlineStatus>}
      {available !== false && session.kind !== "local" && <InlineStatus className="mt-4">{tx.signerApp}</InlineStatus>}
      {available && state === "unavailable" && <InlineStatus className="mt-4">{tx.offline}</InlineStatus>}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}

      {empty ? (
        <EmptyState icon={Users} title={tx.empty.title} description={tx.empty.text} primary={canAdd ? { label: tx.add, onClick: () => setAddOpen(true) } : undefined} secondary={{ label: tx.myCode, onClick: () => setCodeOpen(true) }} />
      ) : (
        <>
          {received.length > 0 && (
            <Group title={tx.sections.requests}>
              {received.map((f) => (
                <PersonRow
                  key={f.pubkey}
                  pubkey={f.pubkey}
                  name={nameOf(f.pubkey)}
                  picture={names(f.pubkey).picture}
                  subtitle={busy === f.pubkey ? <span role="status">{tx.accepting}</span> : f.message ? `${tx.wantsToBe}: „${f.message}“` : tx.wantsToBe}
                  onClick={() => open(f)}
                  action={
                    <Button onClick={() => void accept(f)} disabled={busy !== null} aria-label={tx.acceptFor(nameOf(f.pubkey))} className="h-11 rounded-full px-4 text-[0.9375rem] font-semibold">
                      {tx.accept}
                    </Button>
                  }
                />
              ))}
            </Group>
          )}
          {current.length > 0 && (
            <Group title={tx.sections.friends}>
              {current.map((f) => (
                <PersonRow key={f.pubkey} pubkey={f.pubkey} name={nameOf(f.pubkey)} picture={names(f.pubkey).picture} subtitle={lineOf(f)} onClick={() => open(f)} />
              ))}
            </Group>
          )}
          {sent.length > 0 && (
            <Group title={tx.sections.sent}>
              {sent.map((f) => (
                <PersonRow key={f.pubkey} pubkey={f.pubkey} name={nameOf(f.pubkey)} picture={names(f.pubkey).picture} subtitle={tx.requestSent} onClick={() => open(f)} />
              ))}
            </Group>
          )}
        </>
      )}

      <AddFriendSheet open={addOpen} onOpenChange={setAddOpen} onShowCode={() => setCodeOpen(true)} />
      <ShareSheet open={codeOpen} onOpenChange={setCodeOpen} pubkey={session.pubkey} name={own?.name ?? null} writeRelays={own?.events ? ownRelaySettings(own.events).write : []} />
    </>
  )
}
