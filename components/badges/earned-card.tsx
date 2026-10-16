"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Award, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { FitText } from "@/components/fit-text"
import { useAreaT, useT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { milestoneTexts, problemText } from "@/components/badges/texts"
import { notShownFrom, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { showMilestones } from "@/lib/badges/actions"
import { evaluateMilestones, reachedIn, type MilestoneStatus } from "@/lib/badges/milestones"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import { lookupOwnEvents } from "@/lib/profile/own-events"
import type { FinishedMatch } from "@/lib/shell/registry"
import { kvGet, kvSet } from "@/lib/storage/db"
import { isUnnamed } from "@/lib/storage/players"
import { playerKey } from "@/lib/storage/stats"

// The success card on the result of a finished game (registry "result.actions"): one quiet row
// naming what this game made a player reach, worked out from the archive once the game is in it
// (PLAN.md "Auszeichnungen": a small card that can be put away, never interrupting the game).
// A tap shows the badges; a signed-in player can show their own in their profile from there.
// Nothing is published on its own, and a guest's milestones stay "Auf diesem Gerät erreicht".
//
// The row keeps to what the result asks of its pieces: 48 pt at most; 44 pt without the icon on
// short screens (`short`); in a phone's landscape (`xshort`) one short line that shrinks to fit,
// without background, icon or dismiss button, so it can stand in the result's top bar.

// Games whose card was put away; device-wide, not part of any profile.
const DISMISSED_KEY = "badges.dismissed"
const REMEMBERED = 50

interface Reached {
  seat: number
  name: string
  // The signed-in profile's own seat.
  own: boolean
  statuses: MilestoneStatus[]
}

export default function EarnedCard({ match }: { match: FinishedMatch }) {
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const reduceMotion = useReducedMotion()
  const { all, aliases } = useMatchHistory()
  const own = useOwnProfile()
  const badges = useOwnBadges(own?.session.pubkey ?? null)
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)

  // Every named seat with what the game made its player reach; the profile's seat counts the
  // profile's games on this device as one player's.
  const reached = useMemo<Reached[]>(() => {
    const archived = all.find((m) => m.id === match.id)
    if (!archived) return []
    return archived.players.flatMap((player, seat) => {
      if (player.unnamed || isUnnamed(player.name)) return []
      const mine = !!own?.key && player.pubkey === own.session.pubkey
      const key = mine ? own.key : playerKey(archived, player, aliases)
      if (!key) return []
      const statuses = reachedIn(evaluateMilestones(all, key, { aliases, sameAs: mine ? own.sameAs : undefined }), match.id)
      return statuses.length > 0 ? [{ seat, name: player.name.trim(), own: mine, statuses }] : []
    })
  }, [all, aliases, match.id, own])

  // Of the profile's own, what "Im Profil zeigen" still has to publish; null while the
  // profile's badges are being read.
  const missing = useMemo<MilestoneStatus[] | null>(() => {
    const mine = reached.find((r) => r.own)
    if (!own || !mine) return []
    return badges.awards ? notShownFrom(badges, own.session.pubkey, mine.statuses, match.id) : null
  }, [reached, own, badges, match.id])

  useEffect(() => {
    let alive = true
    kvGet<string[]>(DISMISSED_KEY).then(
      (ids) => alive && setDismissed(!!ids?.includes(match.id)),
      () => alive && setDismissed(false),
    )
    return () => {
      alive = false
    }
  }, [match.id])

  if (dismissed !== false || reached.length === 0) return null

  const dismiss = async () => {
    setDismissed(true)
    const ids = (await kvGet<string[]>(DISMISSED_KEY).catch(() => undefined)) ?? []
    await kvSet(DISMISSED_KEY, [...ids.filter((id) => id !== match.id), match.id].slice(-REMEMBERED)).catch(() => {})
  }

  const count = reached.reduce((n, r) => n + r.statuses.length, 0)
  const first = reached[0]
  const firstName = milestoneTexts(tx, first.statuses[0].milestone).name
  const label = count > 1 ? e.several(count) : match.players.length > 1 ? e.oneOf(first.name, firstName) : e.one(firstName)

  return (
    <>
      {/* One row, as the result screen asks of its pieces; it eases in unless motion is reduced. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }}
        className="flex min-h-12 items-stretch overflow-hidden rounded-2xl bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 short:min-h-11 xshort:rounded-xl xshort:bg-transparent xshort:ring-0"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 pl-4 pr-2 text-left text-[1.0625rem] font-medium transition-colors focus-visible:bg-amber-500/15 focus-visible:outline-none active:bg-amber-500/20 xshort:px-2 xshort:text-[0.9375rem] xshort:text-primary xshort:active:bg-secondary/70"
        >
          <Award className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 short:hidden" aria-hidden="true" />
          <FitText minScale={0.6} className="min-w-0 flex-1 leading-snug">
            {label}
          </FitText>
        </button>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label={e.dismiss}
          className="flex min-w-11 shrink-0 items-center justify-center border-l border-amber-500/30 px-3 text-muted-foreground transition-colors focus-visible:bg-amber-500/15 focus-visible:outline-none active:bg-amber-500/20 xshort:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </motion.div>
      <EarnedSheet open={open} onOpenChange={setOpen} reached={reached} pubkey={own?.session.pubkey ?? null} missing={missing} />
    </>
  )
}

function EarnedSheet({
  open,
  onOpenChange,
  reached,
  pubkey,
  missing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reached: Reached[]
  pubkey: string | null
  missing: MilestoneStatus[] | null
}) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const ownSeat = reached.some((r) => r.own)
  const [state, setState] = useState<"idle" | "showing" | "shown">("idle")
  const [problem, setProblem] = useState<string | null>(null)

  // Before a change, the profile's list is looked up again (like editing the profile).
  const toShow = missing?.length ?? 0
  useEffect(() => {
    if (open && pubkey && toShow > 0) void lookupOwnEvents(pubkey, { again: true })
  }, [open, pubkey, toShow])

  // All of them in one go: one list, one confirmation (lib/badges/actions.ts showMilestones).
  const show = async () => {
    if (!pubkey || !missing) return
    setState("showing")
    setProblem(null)
    try {
      const items = missing.flatMap(({ milestone, achieved }) => (achieved ? [{ milestone, achieved, texts: milestoneTexts(tx, milestone) }] : []))
      if ((await showMilestones(pubkey, items, tx.detail.voided)) === "offline") {
        setProblem(problemText(tx, "offline"))
        setState("idle")
      } else setState("shown")
    } catch (error) {
      setProblem(problemText(tx, error))
      setState("idle")
    }
  }

  // The list may be longer than the screen; the status never is, it stands in the button's
  // place: the confirmation once published, the word that they are in the profile already, else
  // the button, with a problem right above it.
  const slot = "mt-3 min-h-14 shrink-0 items-center xshort:min-h-12"
  const action =
    pubkey && ownSeat ? (
      state === "shown" ? (
        <InlineStatus tone="success" className={slot}>
          {e.shown}
        </InlineStatus>
      ) : missing?.length === 0 ? (
        <InlineStatus tone="info" className={slot}>
          {e.already}
        </InlineStatus>
      ) : (
        <Button onClick={() => void show()} disabled={!missing || state === "showing"} className="mt-3 h-14 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
          {state === "showing" ? e.showing : e.showAll}
        </Button>
      )
    ) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={e.title} description={e.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {reached.map((r) => (
          <section key={r.seat} className="mt-2 first:mt-0">
            {reached.length > 1 && <h3 className="mb-2 px-1 text-[0.8125rem] text-muted-foreground">{r.name}</h3>}
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {r.statuses.map(({ milestone }) => {
                const words = milestoneTexts(tx, milestone)
                return (
                  <li key={milestone.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                    <BadgeIcon size={36} />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="block text-[1.0625rem] leading-snug">{words.name}</span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">{words.description}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {problem && (
        <InlineStatus tone="error" className="mt-3 shrink-0">
          {problem}
        </InlineStatus>
      )}
      {action}
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] xshort:h-11">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
