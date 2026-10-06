"use client"

import { useEffect, useMemo } from "react"
import { ArrowUpDown, Award } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { awardTexts, milestoneTexts, progressText } from "@/components/badges/texts"
import { selfAwardFor, useMilestones, useOwnBadges, type OwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile, type OwnProfile } from "@/components/profile/use-profile"
import type { ValidAward } from "@/lib/badges/awards"
import { evaluateMilestones, type MilestoneStatus } from "@/lib/badges/milestones"
import { selfAwardHolds } from "@/lib/badges/self-award"
import { lookupBadges, markAwardsSeen } from "@/lib/badges/store"
import { BADGES_TEXTS, type BadgesTexts } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import { useSession } from "@/lib/profile/session"
import { summarizePlayers } from "@/lib/storage/stats"

// Profil › Auszeichnungen (PLAN.md "Auszeichnungen gewinnen und im Profil zeigen"): what the
// profile shows, what it reached and was given, and what is within reach with how far it is.
// A guest sees what the device's players reached here.
export default function BadgesScreen() {
  const session = useSession()
  if (session === undefined) return null
  return session ? <OwnBadgesScreen /> : <GuestBadgesScreen />
}

function AwardRow({ award, subtitle }: { award: ValidAward; subtitle?: string }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { name } = awardTexts(tx, award)
  return <ListRow icon={Award} iconTone="orange" title={name} subtitle={subtitle} onClick={() => nav.push(BADGE_SCREENS.badge, { id: award.award.id, name })} />
}

function MilestoneRow({ status, playerKey, subtitle, reached }: { status: MilestoneStatus; playerKey: string; subtitle?: string; reached: boolean }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { name } = milestoneTexts(tx, status.milestone)
  return (
    <ListRow
      icon={Award}
      iconTone={reached ? "orange" : "gray"}
      title={name}
      subtitle={subtitle}
      onClick={() => nav.push(BADGE_SCREENS.badge, { milestone: status.milestone.id, key: playerKey, name })}
    />
  )
}

function Reachable({ statuses, playerKey }: { statuses: MilestoneStatus[]; playerKey: string }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const open = statuses.filter((s) => !s.achieved)
  if (open.length === 0) return null
  return (
    <Group title={tx.list.reachable} footer={tx.list.reachableFooter}>
      {open.map((status) => (
        <MilestoneRow key={status.milestone.id} status={status} playerKey={playerKey} subtitle={progressText(t, tx, status)} reached={false} />
      ))}
    </Group>
  )
}

// What the profile reached and was given, apart from what it shows: milestones reached here
// (with their self-earned award, if published), and awards from others.
function earned(own: OwnProfile, badges: OwnBadges, statuses: MilestoneStatus[], tx: BadgesTexts) {
  const { pubkey } = own.session
  const shownIds = new Set(badges.shown.map((a) => a.award.id))
  const rows: { key: string; award?: ValidAward; status?: MilestoneStatus; subtitle: string }[] = []
  for (const status of statuses) {
    if (!status.achieved) continue
    const award = selfAwardFor(badges, pubkey, status.milestone.id, status.milestone.version)
    if (award && shownIds.has(award.award.id)) continue
    const holds = award ? selfAwardHolds(award, badges.evidence.get(award.blueline?.evidence ?? "") ?? null, own.history.all, own.key ?? "", { aliases: own.history.aliases, sameAs: own.sameAs }) : null
    rows.push({ key: status.milestone.id, award, status, subtitle: holds === false ? tx.list.corrected : award ? tx.detail.notInProfile : tx.list.onDevice })
  }
  for (const award of badges.received) if (!shownIds.has(award.award.id)) rows.push({ key: award.award.id, award, subtitle: award.voided ? tx.list.corrected : tx.list.received })
  return rows
}

function OwnBadgesScreen() {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const own = useOwnProfile()
  const pubkey = own?.session.pubkey ?? ""
  const badges = useOwnBadges(pubkey)
  const { statuses, loaded } = useMilestones(own?.key ?? null, own?.history.aliases, own?.sameAs)

  // Opening the badges looks for new ones, and counts the ones from others as seen.
  useEffect(() => {
    if (pubkey) void lookupBadges(pubkey, { again: true })
  }, [pubkey])
  const receivedIds = badges.received.map((a) => a.award.id).join(",")
  useEffect(() => {
    if (badges.awards !== null) void markAwardsSeen(receivedIds ? receivedIds.split(",") : []).catch(() => {})
  }, [badges.awards, receivedIds])

  const rows = useMemo(() => (own && badges.awards ? earned(own, badges, statuses, tx) : []), [own, badges, statuses, tx])
  if (!own || !loaded || badges.awards === null) return null
  const playerKey = own.key ?? ""
  const nothing = badges.shown.length === 0 && rows.length === 0

  return (
    <>
      {nothing && <EmptyState icon={Award} title={tx.list.none} description={tx.list.noneText} className="pt-6" />}
      {badges.shown.length > 0 && (
        <Group title={tx.list.shown} footer={tx.list.shownFooter}>
          {badges.shown.map((award) => (
            <AwardRow key={award.award.id} award={award} />
          ))}
          {badges.shown.length > 1 && <ListRow icon={ArrowUpDown} iconTone="gray" title={tx.list.arrange} onClick={() => nav.push(BADGE_SCREENS.arrange)} />}
        </Group>
      )}
      {rows.length > 0 && (
        <Group title={tx.list.earned}>
          {rows.map((row) =>
            row.award ? <AwardRow key={row.key} award={row.award} subtitle={row.subtitle} /> : <MilestoneRow key={row.key} status={row.status as MilestoneStatus} playerKey={playerKey} subtitle={row.subtitle} reached />,
          )}
        </Group>
      )}
      <Reachable statuses={statuses} playerKey={playerKey} />
    </>
  )
}

// This device's players and what each reached here (most games first); a profile would let
// them show badges in it (the offer is in the Profile tab itself, never here as a gate).
function GuestBadgesScreen() {
  const tx = useAreaT(BADGES_TEXTS)
  const { all, aliases, loaded } = useMatchHistory()
  const players = useMemo(
    () =>
      summarizePlayers(all, { aliases })
        .filter((s) => !s.unnamed)
        .map((s) => ({ key: s.key, name: s.name, statuses: evaluateMilestones(all, s.key, { aliases }) }))
        .filter((p) => p.statuses.some((m) => m.achieved)),
    [all, aliases],
  )
  if (!loaded) return null
  if (players.length === 0) return <EmptyState icon={Award} title={tx.list.none} description={tx.list.noneText} className="pt-6" />
  return (
    <>
      {players.map((player, i) => (
        <Group key={player.key} title={player.name} footer={i === players.length - 1 ? tx.list.guestFooter : undefined}>
          {player.statuses
            .filter((s) => s.achieved)
            .map((status) => (
              <MilestoneRow key={status.milestone.id} status={status} playerKey={player.key} subtitle={tx.list.onDevice} reached />
            ))}
        </Group>
      ))}
    </>
  )
}
