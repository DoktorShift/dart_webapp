"use client"

import { useState } from "react"
import { ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { PersonRow } from "@/components/common/person-row"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { SheetCode } from "@/components/common/sheet-code"
import { useRecentPlayers } from "@/components/common/use-recent-players"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetButton, useChange } from "@/components/clubs/common"
import { useFriends } from "@/components/friends/use-friends"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { byState } from "@/lib/friends/model"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { nextDate, type ClubView } from "@/lib/clubs/club"
import { sendInvitation } from "@/lib/clubs/invitations"
import { clubLink } from "@/lib/clubs/links"
import { createInvite } from "@/lib/clubs/membership"
import { nowSeconds } from "@/lib/nostr/time"
import { readProfileCode, type ProfileAddress } from "@/lib/profile/profile-link"
import type { ClubState } from "@/lib/protocol/club-state"
import { SITE } from "@/lib/site"

const PERSONAL_DAYS = 7

type Person = { pubkey: string; name: string; relays: readonly string[] }
type Outcome = { person: Person; invite: string; token: string; delivered: boolean }

// "Person einladen": a personal invitation straight to someone's profile, so the friend at the
// next table has it under Clubs without scanning anything. Pick a friend, someone from "Zuletzt
// gespielt mit", or scan their profile code; the invitation is made and sent in one go. If no
// relay takes it, the same invitation shows as a code to scan instead, so the moment is never lost.
export function InvitePersonSheet({ view, state, open, onOpenChange }: { view: ClubView; state: ClubState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const own = useOwnProfile()
  const ftx = useAreaT(FRIENDS_TEXTS)
  const { friends: friendList } = useFriends()
  const friends = (friendList ? byState(friendList, "friend") : []).filter((f) => !state.members[f.pubkey]).map((f) => f.pubkey)
  const { players, loaded } = useRecentPlayers({ withProfile: true })
  const candidates = players.filter((p) => p.pubkey && !state.members[p.pubkey] && !friends.includes(p.pubkey)).slice(0, 8)
  // A profile code that was scanned: confirmed by name before the invitation goes out.
  const [scanned, setScanned] = useState<Person | null>(null)
  const names = useProfileNames([...friends, ...candidates.map((p) => p.pubkey as string), ...(scanned ? [scanned.pubkey] : [])])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const close = (next: boolean) => {
    if (!next) {
      setScanning(false)
      setScanned(null)
      setBusy(null)
      setProblem(null)
      setOutcome(null)
    }
    onOpenChange(next)
  }

  const invite = async (person: Person) => {
    setBusy(person.pubkey)
    setProblem(null)
    try {
      const author = await clubAuthor()
      const next = nextDate(view, nowSeconds())
      const hostName = own?.name ?? undefined
      const made = await createInvite(
        state,
        { kind: "personal", days: PERSONAL_DAYS, label: person.name, ...(hostName ? { hostName } : {}), ...(next ? { next: { title: next.title, starts: next.starts, ...(next.place ? { place: next.place } : {}) } } : {}) },
        author,
      )
      const sent = await sendInvitation(state, { invite: made.invite, token: made.token }, { pubkey: person.pubkey, relays: person.relays }, { relays: view.relays, ...(hostName ? { hostName } : {}) }, author).catch(() => ({ published: false }))
      setOutcome({ person, invite: made.invite, token: made.token, delivered: sent.published })
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(null)
    }
  }

  const onScan = async (text: string): Promise<ScanVerdict> => {
    const address: ProfileAddress | null = await readProfileCode(text, [window.location.origin, SITE.url])
    if (!address) return tx.invites.notProfile
    if (state.members[address.pubkey]) return tx.invites.alreadyIn(names(address.pubkey).name ?? tx.unnamed)
    setScanning(false)
    setScanned({ pubkey: address.pubkey, name: "", relays: address.relays })
  }

  const nameOf = (person: Person) => person.name || names(person.pubkey).name || ""
  const busyName = busy ? nameOf(candidates.filter((p) => p.pubkey === busy).map((p) => ({ pubkey: busy, name: p.name, relays: [] }))[0] ?? scanned ?? { pubkey: busy, name: "", relays: [] }) : null

  return (
    <Sheet open={open} onOpenChange={close} title={tx.invites.toPersonTitle} description={outcome ? undefined : tx.invites.toPersonText}>
      <SheetBody>
        {outcome ? (
          <Delivered outcome={outcome} view={view} />
        ) : busyName ? (
          <p role="status" aria-live="polite" className="py-10 text-center text-[1.0625rem] text-muted-foreground">
            {tx.invites.sendingTo(busyName)}
          </p>
        ) : scanning ? (
          <>
            <QRScanner className="mt-2" onResult={onScan} manualLabel={tx.invites.scanPerson} />
            <Button variant="ghost" onClick={() => setScanning(false)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
              {tx.invites.back}
            </Button>
          </>
        ) : scanned ? (
          <>
            <Group title={tx.invites.scanned} className="mt-2">
              <InviteRow pubkey={scanned.pubkey} name={nameOf(scanned)} picture={names(scanned.pubkey).picture} onInvite={() => void invite({ ...scanned, name: nameOf(scanned) })} />
            </Group>
            <Button variant="ghost" onClick={() => setScanned(null)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
              {tx.invites.back}
            </Button>
          </>
        ) : (
          <>
            <Group className="mt-2">
              <ListRow icon={ScanLine} iconTone="blue" title={tx.invites.scanPerson} onClick={() => setScanning(true)} />
            </Group>
            {friends.length > 0 && (
              <Group title={ftx.invite.group}>
                {friends.map((pubkey) => {
                  const info = names(pubkey)
                  return <InviteRow key={pubkey} pubkey={pubkey} name={info.name ?? tx.unnamed} picture={info.picture} onInvite={() => void invite({ pubkey, name: info.name ?? tx.unnamed, relays: friendList?.entries.find((f) => f.pubkey === pubkey)?.relays ?? [] })} />
                })}
              </Group>
            )}
            {loaded && candidates.length === 0 && <p className="mt-4 px-4 text-[0.8125rem] text-muted-foreground">{tx.invites.noRecent}</p>}
            {candidates.length > 0 && <Group title={tx.invites.recent}>
              {candidates.map((p) => {
                const pubkey = p.pubkey as string
                const info = names(pubkey)
                return <InviteRow key={pubkey} pubkey={pubkey} name={info.name ?? p.name} picture={info.picture} onInvite={() => void invite({ pubkey, name: info.name ?? p.name, relays: [] })} />
              })}
            </Group>}
          </>
        )}
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
      </SheetBody>
      <SheetButton onClick={() => close(false)}>{t.common.done}</SheetButton>
    </Sheet>
  )
}

// One person to invite: face, name, and "Einladen" on a 44 pt target.
function InviteRow({ pubkey, name, picture, onInvite }: { pubkey: string; name: string; picture: string | null; onInvite: () => void }) {
  const tx = useAreaT(CLUBS_TEXTS)
  return (
    <PersonRow
      pubkey={pubkey}
      name={name || tx.unnamed}
      picture={picture}
      action={
        <Button variant="secondary" onClick={onInvite} className="h-11 rounded-full px-4 text-[0.9375rem] font-semibold text-primary">
          {tx.invites.send}
        </Button>
      }
    />
  )
}

// After sending: the confirmation, or the same invitation as a code when no relay took it.
function Delivered({ outcome, view }: { outcome: Outcome; view: ClubView }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const name = outcome.person.name
  if (outcome.delivered) {
    return (
      <InlineStatus tone="success" className="mt-2">
        {tx.invites.sentTo(name)}
      </InlineStatus>
    )
  }
  const link = clubLink(SITE.url, { club: view.id, invite: { id: outcome.invite, token: outcome.token }, relays: view.relays })
  return (
    <>
      <InlineStatus tone="error" className="mb-4">
        {tx.invites.sendFailed}
      </InlineStatus>
      <SheetCode value={link} label={tx.invites.title} caption={tx.invites.caption} share={{ url: link, title: tx.invites.shareTitle(view.info?.name ?? "") }} />
    </>
  )
}
