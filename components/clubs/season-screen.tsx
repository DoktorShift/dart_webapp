"use client"

import { useState } from "react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { Confirm, SheetBody, SheetButton, formatDate, useChange } from "@/components/clubs/common"
import { ScoringText } from "@/components/clubs/scoring"
import { SeasonForm } from "@/components/clubs/season-form"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { isManager } from "@/lib/clubs/club"
import { endSeason } from "@/lib/clubs/seasons"
import { currentSeason, rulesOf } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import type { ScreenProps } from "@/lib/shell/registry"

// "Saison": the current season's rules with every version and its reason, "Regeln ändern" and
// "Saison beenden" for leaders; without a season, the form to set one up.
export default function SeasonScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const describe = useChange()
  const { view } = useClub(params.club ?? null)
  const [changing, setChanging] = useState(false)
  const [ending, setEnding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const state = view?.state
  if (!view || !state) return null
  const manager = isManager(view.me.role) && !state.info.archived
  const season = currentSeason(state, nowSeconds())
  if (!season) {
    if (!manager) return <InlineStatus tone="info" className="mt-6">{tx.table.noSeasonText}</InlineStatus>
    return <SeasonForm state={state} onDone={() => nav.pop()} />
  }
  const versions = [...season.versions].reverse()

  const end = async () => {
    setProblem(null)
    try {
      await endSeason(state, season, await clubAuthor())
      nav.pop()
    } catch (error) {
      setProblem(describe(error))
    }
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
