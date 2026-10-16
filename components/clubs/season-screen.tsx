"use client"

import { useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { seasonOccasion } from "@/components/clubs/awards"
import { SheetBody, SheetButton, formatDate, useChange } from "@/components/clubs/common"
import { Confirm } from "@/components/ui/confirm"
import { ScoringText } from "@/components/clubs/scoring"
import { AwardsRow, useGiveAwards } from "@/components/clubs/season-awards"
import { SeasonForm } from "@/components/clubs/season-form"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import type { BadgeOccasion } from "@/lib/badges/organizer"
import { isManager } from "@/lib/clubs/club"
import { endSeason } from "@/lib/clubs/seasons"
import { currentSeason, rulesOf } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import { featureOn } from "@/lib/shell/features"
import type { ScreenProps } from "@/lib/shell/registry"

// "Saison": the current season's rules with every version and its reason, "Regeln ändern" and
// "Saison beenden" for leaders; without a season, the form to set one up. Ending a season gives
// its badges at once (winner, regulars); when that can't happen now, the screen says so and
// offers it again, as "Club verwalten" does later.
export default function SeasonScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const describe = useChange()
  const giveAwards = useGiveAwards()
  const { view } = useClub(params.club ?? null)
  const [changing, setChanging] = useState(false)
  const [ending, setEnding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The season just ended here whose badges couldn't be given yet.
  const [ungiven, setUngiven] = useState<BadgeOccasion | null>(null)
  const state = view?.state
  if (!view || !state) return null
  if (ungiven) {
    return (
      <div className="pb-4">
        <Group title={tx.season.current}>
          <ListRow title={ungiven.name} value={tx.season.ended} />
        </Group>
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        <Group footer={tx.season.awardsLater}>
          <AwardsRow occasion={ungiven} onDone={(next) => (next ? setProblem(next) : nav.pop())} />
        </Group>
      </div>
    )
  }
  const manager = isManager(view.me.role) && !state.info.archived
  const season = currentSeason(state, nowSeconds())
  if (!season) {
    if (!manager) return <InlineStatus tone="info" className="mt-6">{tx.table.noSeasonText}</InlineStatus>
    return <SeasonForm state={state} onDone={() => nav.pop()} />
  }
  const versions = [...season.versions].reverse()

  const end = async () => {
    setProblem(null)
    let occasion: BadgeOccasion
    try {
      const [record] = (await endSeason(state, season, await clubAuthor())).events
      occasion = seasonOccasion(state, season, { event: record.id, by: record.pubkey, at: record.created_at }, view.games)
    } catch (error) {
      setProblem(describe(error))
      return
    }
    const awardsProblem = featureOn("badges") ? await giveAwards(occasion) : null
    if (!awardsProblem) return nav.pop()
    setProblem(awardsProblem)
    setUngiven(occasion)
  }

  return (
    <div className="pb-4">
      <Group title={tx.season.current}>
        <ListRow title={season.name} subtitle={tx.table.period(formatDate(season.starts, t), season.ends !== undefined ? formatDate(season.ends, t) : null)} value={season.ended ? tx.season.ended : undefined} />
      </Group>
      <Group title={tx.season.rules}>
        <div className="px-4 py-3">
          <ScoringText rules={rulesOf(season)} />
        </div>
        {versions.map((v) => (
          <ListRow key={v.version} title={tx.table.version(v.version, formatDate(v.at, t))} subtitle={v.reason ? tx.table.reason(v.reason) : undefined} />
        ))}
      </Group>
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      {manager && !season.ended && (
        <Group>
          <ListRow title={tx.season.changeRules} onClick={() => setChanging(true)} />
          <ListRow title={tx.season.end} destructive onClick={() => setEnding(true)} />
        </Group>
      )}
      <Sheet open={changing} onOpenChange={setChanging} title={tx.season.changeRules}>
        <SheetBody>{changing && <SeasonForm state={state} season={season} onDone={() => setChanging(false)} />}</SheetBody>
        <SheetButton onClick={() => setChanging(false)}>{t.common.cancel}</SheetButton>
      </Sheet>
      <Confirm open={ending} onOpenChange={setEnding} title={tx.season.endTitle} text={tx.season.endText} confirm={tx.season.endConfirm} destructive onConfirm={() => void end()} />
    </div>
  )
}
