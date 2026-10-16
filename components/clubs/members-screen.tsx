"use client"

import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDate } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { InviteSheet } from "@/components/clubs/invite-sheet"
import { MemberSheet } from "@/components/clubs/member-sheet"
import { RequestList } from "@/components/clubs/request-list"
import { useClub } from "@/components/clubs/use-clubs"
import { sameNames, useProfileNames } from "@/components/profile/use-profile-names"
import { shortKey } from "@/lib/nostr/pointers"
import { isLeader, isManager } from "@/lib/clubs/club"
import type { ClubRole } from "@/lib/protocol/club"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

const ORDER: Record<ClubRole, number> = { owner: 0, admin: 1, director: 2, member: 3 }

// "Spieler": the members with their roles, leaders first. A name opens the player's profile;
// for a leader it opens what they can do with the member. Two people with the same name are
// told apart by the start of their id (design rules). Leaders also see the requests here.
export default function MembersScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const { view } = useClub(params.club ?? null)
  const state = view?.state
  const members = state ? Object.values(state.members) : []
  const names = useProfileNames(members.map((m) => m.pubkey))
  const [inviting, setInviting] = useState(false)
  const [managing, setManaging] = useState<string | null>(null)
  if (!view || !state) return null
  const me = view.me.pubkey
  const manager = isManager(view.me.role)
  // Every leader opens a member's sheet (a recognition); managers also find roles and more there.
  const leader = isLeader(view.me.role)
  const nameOf = (pubkey: string) => names(pubkey).name ?? tx.unnamed
  const dup = sameNames(members.map((m) => ({ pubkey: m.pubkey, name: nameOf(m.pubkey) })))
  const sorted = [...members].sort((a, b) => ORDER[a.role] - ORDER[b.role] || nameOf(a.pubkey).localeCompare(nameOf(b.pubkey)))

  return (
    <div className="pb-4">
      {manager && !state.info.archived && (
        <Button onClick={() => setInviting(true)} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.club.invite}
        </Button>
      )}
      {manager && <RequestList state={state} />}
      <Group footer={sorted.length === 1 ? tx.members.onlyYou : undefined}>
        {sorted.map((m) => {
          const info = names(m.pubkey)
          return (
            <ListRow
              key={m.pubkey}
              title={
                <span className="flex items-center gap-3">
                  <Avatar seed={m.pubkey} name={info.name ?? undefined} src={info.picture} size={36} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {info.name ?? tx.unnamed}
                    {m.pubkey === me && <span className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-[0.75rem] font-semibold text-primary-foreground">{tx.you}</span>}
                  </span>
                </span>
              }
              subtitle={[tx.roles[m.role], dup.has(m.pubkey) || !info.name ? tx.id(shortKey(m.pubkey)) : null, tx.members.since(formatDate(t, m.since * 1000))].filter(Boolean).join(" · ")}
              onClick={() => (leader && m.pubkey !== me ? setManaging(m.pubkey) : nav.push(SCREENS.profilePublic, { pubkey: m.pubkey }))}
            />
          )
        })}
      </Group>
      <InviteSheet view={view} state={state} open={inviting} onOpenChange={setInviting} />
      <MemberSheet view={view} state={state} member={managing} open={managing !== null} onOpenChange={(open) => !open && setManaging(null)} />
    </div>
  )
}
