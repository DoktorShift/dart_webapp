"use client"

import { useEffect, useMemo } from "react"
import { ArrowUpDown, Award } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { AwardRow, MilestoneRow } from "@/components/badges/rows"
import { BADGE_SCREENS } from "@/components/badges/screens"
import { progressText } from "@/components/badges/texts"
import { awardVoided, selfAwardFor, useMilestones, useOwnBadges, type OwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile, type OwnProfile } from "@/components/profile/use-profile"
import type { ValidAward } from "@/lib/badges/awards"
import { evaluateMilestones, type MilestoneStatus } from "@/lib/badges/milestones"
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
// (with their self-earned award, if published), and awards from issuers it vouches for.
function earned(own: OwnProfile, badges: OwnBadges, statuses: MilestoneStatus[], tx: BadgesTexts) {
  const { pubkey } = own.session
  const shownIds = new Set(badges.shown.map((a) => a.award.id))
  const rows: { key: string; award?: ValidAward; status?: MilestoneStatus; subtitle: string; voided: boolean }[] = []
  for (const status of statuses) {
    if (!status.achieved) continue
    const award = selfAwardFor(badges, pubkey, status.milestone.id, status.milestone.version)
    if (award && shownIds.has(award.award.id)) continue
    rows.push({ key: status.milestone.id, award, status, subtitle: award ? tx.detail.notInProfile : tx.list.onDevice, voided: award ? awardVoided(own, badges, award) : false })
  }
  for (const award of badges.received) if (!shownIds.has(award.award.id)) rows.push({ key: award.award.id, award, subtitle: tx.list.received, voided: awardVoided(own, badges, award) })
  return rows
}

function OwnBadgesScreen() {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const own = useOwnProfile()
  const badges = useOwnBadges(own?.session.pubkey ?? null)
  const { statuses, loaded } = useMilestones(own?.key ?? null, own?.history.aliases, own?.sameAs)

  // Opening the badges looks for new ones, and counts the ones from others as seen.
  const pubkey = own?.session.pubkey
  useEffect(() => {
    if (pubkey) void lookupBadges(pubkey, { again: true })
  }, [pubkey])
  const receivedIds = [...badges.received, ...badges.unvouched].map((a) => a.award.id).join(",")
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
            <AwardRow key={award.award.id} award={award} voided={awardVoided(own, badges, award)} />
          ))}
          {badges.shown.length > 1 && <ListRow icon={ArrowUpDown} iconTone="gray" title={tx.list.arrange} onClick={() => nav.push(BADGE_SCREENS.arrange)} />}
        </Group>
      )}
      {rows.length > 0 && (
        <Group title={tx.list.earned}>
          {rows.map((row) =>
            row.award ? (
              <AwardRow key={row.key} award={row.award} subtitle={row.subtitle} voided={row.voided} />
            ) : (
              <MilestoneRow key={row.key} status={row.status as MilestoneStatus} playerKey={playerKey} subtitle={row.subtitle} reached />
            ),
          )}
        </Group>
      )}
      <Reachable statuses={statuses} playerKey={playerKey} />
      {badges.unvouched.length > 0 && (
        <Group footer={tx.list.moreFooter}>
          <ListRow icon={Award} iconTone="gray" title={tx.list.more} value={String(badges.unvouched.length)} onClick={() => nav.push(BADGE_SCREENS.more)} />
        </Group>
      )}
    </>
  )
}

// This device's players and what each reached here (most games first); a profile would let
// them show badges in it (the offer is in the Profile tab itself, never here as a gate). A
// player known only from imported 1.0.0 results is marked so, as the Rangliste marks them.
function GuestBadgesScreen() {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const { all, aliases, loaded } = useMatchHistory()
  const players = useMemo(
    () =>
      summarizePlayers(all, { aliases })
        .filter((s) => !s.unnamed)
        .map((s) => ({ key: s.key, name: s.name, imported: s.imported, statuses: evaluateMilestones(all, s.key, { aliases }) }))
        .filter((p) => p.statuses.some((m) => m.achieved)),
    [all, aliases],
  )
  if (!loaded) return null
  if (players.length === 0) return <EmptyState icon={Award} title={tx.list.none} description={tx.list.noneText} className="pt-6" />
  return (
    <>
      {players.map((player, i) => (
        <Group key={player.key} title={player.imported ? `${player.name} · ${t.data.importedTag}` : player.name} footer={i === players.length - 1 ? tx.list.guestFooter : undefined}>
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
