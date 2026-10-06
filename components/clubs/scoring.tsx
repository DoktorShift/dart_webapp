"use client"

import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { modeName } from "@/lib/i18n"
import type { SeasonRules } from "@/lib/protocol/club"

// "So wird gewertet": a season's rules in sentences, exactly what lib/clubs/table.ts does.
export function ScoringText({ rules }: { rules: SeasonRules }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  return (
    <ul className="flex flex-col gap-2 text-[0.9375rem] leading-snug">
      <li>{tx.table.scoringModes(rules.modes.map((id) => modeName(t, id, id)).join(", "))}</li>
      <li>{tx.table.scoringPoints(rules.points.win, rules.points.draw, rules.points.loss)}</li>
      <li>{tx.table.scoringConfirm[rules.confirmations]}</li>
      {rules.minGames > 0 && <li>{tx.table.scoringMin(rules.minGames)}</li>}
      {rules.tiebreak.length > 0 && (
        <li>
          {tx.table.scoringTiebreak}
          <ol className="mt-1 list-decimal pl-5">
            {rules.tiebreak.map((criterion) => (
              <li key={criterion}>{tx.table.tiebreak[criterion]}</li>
            ))}
          </ol>
          <span className="mt-1 block">{tx.table.shared}</span>
        </li>
      )}
    </ul>
  )
}
