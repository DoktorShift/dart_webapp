"use client"

import { useState } from "react"
import { Segmented } from "@/components/ui/segmented"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { clubAuthor } from "@/components/clubs/use-clubs"
import type { ClubView } from "@/lib/clubs/club"
import { answerDate, type Answer, type ClubDate } from "@/lib/clubs/dates"
import type { ClubState } from "@/lib/protocol/club-state"

const ANSWERS: Answer[] = ["yes", "maybe", "no"]

// How many said yes, and how many maybe.
export const answerCounts = (date: ClubDate) => {
  const answers = Object.values(date.answers).map((a) => a.answer)
  return { yes: answers.filter((a) => a === "yes").length, maybe: answers.filter((a) => a === "maybe").length }
}

// "Kommst du?": one tap, changeable any time.
export function DateAnswer({ view, state, date }: { view: ClubView; state: ClubState; date: ClubDate }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const me = view.me.pubkey
  const current = me ? (date.answers[me]?.answer ?? null) : null
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const choose = async (answer: Answer) => {
    if (busy || answer === current) return
    setBusy(true)
    setProblem(null)
    try {
      await answerDate(state, date, answer, await clubAuthor())
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-[0.8125rem] text-muted-foreground">{tx.dates.yourAnswer}</p>
      <Segmented label={tx.dates.yourAnswer} options={ANSWERS.map((a) => ({ value: a, label: tx.dates[a], disabled: busy }))} value={current ?? undefined} onChange={(a) => void choose(a)} />
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
    </div>
  )
}
