"use client"

import { useEffect, useId, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react"
import { ChevronDown, Share } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { ChoiceRow, Group, SwitchRow } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PRIMARY, QUIET, useProblemText } from "@/components/tournaments/common"
import { useInlineProfile } from "@/components/profile/inline-profile"
import { ShareSheet } from "@/components/tournaments/share-sheet"
import { tournamentAuthor } from "@/components/tournaments/use-tournaments"
import { createLocalKey, createLocalSigner } from "@/lib/nostr/signers"
import { nowSeconds } from "@/lib/nostr/time"
import { sealSecret } from "@/lib/profile/vault"
import { reduceTournament } from "@/lib/protocol/tournament-state"
import type { ScreenParams } from "@/lib/shell/nav"
import type { ScreenProps } from "@/lib/shell/registry"
import { SCREENS } from "@/lib/shell/registry"
import { randomHex } from "@/lib/storage/ids"
import { cleanNames, draftProblems, foundContent, newDraft, type DraftProblem, type TournamentDraft } from "@/lib/tournaments/draft"
import { commitSeed, createDrawSeed, MAX_ROUND_ROBIN, type TournamentFormat } from "@/lib/tournaments/engine"
import { boardTemplate, foundTemplate, guestTemplate } from "@/lib/tournaments/records"
import { send } from "@/lib/tournaments/send"
import { deleteDraft, loadDraft, saveDraft, updateTournament } from "@/lib/tournaments/store"
import { cn } from "@/lib/utils"

// "Turnier erstellen" in four short steps (PLAN.md): Eckdaten, Format & Regeln, Teilnehmer &
// Boards, Vorschau. Every change is saved as a draft on this device; the preview names what is
// still missing and publishes. A guest gets a profile on the way. Opened fresh, with a draft
// (params.draft), or from a club (params.club, params.name).
const STEPS = 4
const FORMATS: TournamentFormat[] = ["single", "double", "roundRobin", "groups"]
const START_SCORES = [301, 501, 701]
// Five choices at most per row, so each stays a 44 pt target on an iPhone SE; more places can be
// set later under "Angaben ändern".
const LEGS = [1, 2, 3, 4, 5]
const SETS = [1, 2, 3]
const CAPACITIES = [4, 8, 16, 32, 64]
const GROUP_COUNTS = [2, 4, 8, 16]
const ADVANCE = [1, 2, 4]

// A published tournament; `incomplete` when its guests or boards could not be added yet.
interface Published {
  id: string
  name: string
  incomplete: boolean
}

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

export default function CreateScreen({ params }: ScreenProps) {
  const [draft, setDraft] = useState<TournamentDraft | null>(null)
  useEffect(() => {
    let current = true
    const fresh = () => newDraft(randomHex(8), deviceZone(), Date.now(), params.club ? { club: params.club, clubName: params.name ?? "" } : {})
    void (params.draft ? loadDraft(params.draft) : Promise.resolve(null)).then(
      (found) => current && setDraft(found ?? fresh()),
      () => current && setDraft(fresh()),
    )
    return () => {
      current = false
    }
  }, [params.draft, params.club, params.name])
  if (!draft) return null
  return <CreateFlow initial={draft} params={params} />
}

function CreateFlow({ initial, params }: { initial: TournamentDraft; params: ScreenParams }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  const nav = useNav()
  const [draft, setDraft] = useState(initial)
  const [step, setStep] = useState(0)
  const [published, setPublished] = useState<Published | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Saved a moment after the last change, so typing never waits for the database.
  const change = (patch: Partial<TournamentDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch, updatedAt: Date.now() }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void saveDraft(next).catch(() => {}), 400)
      return next
    })
  useEffect(() => () => clearTimeout(timer.current), [])

  if (published) return <PublishedView {...published} />
  return (
    <div className="pb-4">
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">{c.step(step + 1, STEPS)}</p>
      <h2 className="text-xl font-semibold leading-tight">{c.steps[step]}</h2>
      <StepBar step={step} />
      {step === 0 && <Basics draft={draft} change={change} />}
      {step === 1 && <FormatAndRules draft={draft} change={change} />}
      {step === 2 && <PlayersAndBoards draft={draft} change={change} />}
      {step === 3 && <Preview draft={draft} onPublished={setPublished} />}
      <div className="mt-8 grid gap-2">
        {step < STEPS - 1 && (
          <Button onClick={() => setStep(step + 1)} className={PRIMARY}>
            {c.next}
          </Button>
        )}
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)} className={QUIET}>
            {c.steps[step - 1]}
          </Button>
        )}
        {step === 0 && (
          <Button variant="ghost" onClick={() => setDiscarding(true)} className="h-12 w-full rounded-2xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
            {c.deleteDraft}
          </Button>
        )}
      </div>
      <p className="mt-3 text-center text-[0.8125rem] text-muted-foreground">{c.autosaved}</p>
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{c.deleteDraftTitle}</AlertDialogTitle>
            <AlertDialogDescription>{c.autosaved}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                clearTimeout(timer.current)
                void deleteDraft(draft.id).catch(() => {})
                nav.pop()
              }}
            >
              {c.deleteDraft}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {params.club && <p className="sr-only">{c.club(params.name ?? "")}</p>}
    </div>
  )
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-1" aria-hidden="true">
      {Array.from({ length: STEPS }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-secondary")} />
      ))}
    </div>
  )
}

// A multi-line field in the inset grouped style, for name lists.
function TextArea({ label, hint, className, ...input }: { label: string; hint?: string; className?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">) {
  const id = useId()
  return (
    <div className={cn("mt-6", className)}>
      <label htmlFor={id} className="mb-2 block px-4 text-[0.8125rem] text-muted-foreground">
        {label}
      </label>
      <textarea id={id} rows={4} className="w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-[1.0625rem] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring" {...input} />
      {hint && <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

type StepProps = { draft: TournamentDraft; change: (patch: Partial<TournamentDraft>) => void }

function Basics({ draft, change }: StepProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  return (
    <>
      {draft.clubName && <InlineStatus className="mt-4">{c.club(draft.clubName)}</InlineStatus>}
      <TextField label={c.name} value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder={c.namePlaceholder} maxLength={60} autoCapitalize="words" autoFocus />
      <TextField label={c.about} value={draft.about} onChange={(e) => change({ about: e.target.value })} placeholder={c.aboutPlaceholder} maxLength={500} />
      <TextField label={c.starts} type="datetime-local" value={draft.starts} onChange={(e) => change({ starts: e.target.value })} hint={c.timezone(draft.timezone)} />
      <TextField label={c.place} value={draft.place} onChange={(e) => change({ place: e.target.value })} placeholder={c.placePlaceholder} maxLength={140} disabled={draft.online} />
      <Group>
        <SwitchRow title={c.online} hint={c.onlineHint} checked={draft.online} onCheckedChange={(online) => change({ online })} />
      </Group>
    </>
  )
}

function FormatAndRules({ draft, change }: StepProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  const rules = (patch: Partial<TournamentDraft["rules"]>) => change({ rules: { ...draft.rules, ...patch } })
  const options = <T extends number>(values: T[]) => values.map((v) => ({ value: v, label: String(v) }))
  return (
    <>
      <section className="mt-6">
        <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{c.format}</p>
        <ChoiceList label={c.format} options={FORMATS.map((f) => ({ value: f, title: tx.formats[f].name, subtitle: tx.formats[f].summary }))} value={draft.format} onChange={(format) => change({ format })} />
      </section>
      {draft.format === "double" && (
        <Group>
          <SwitchRow title={tx.grandFinalReset} hint={tx.grandFinalResetHint} checked={draft.grandFinalReset} onCheckedChange={(grandFinalReset) => change({ grandFinalReset })} />
        </Group>
      )}
      {(draft.format === "roundRobin" || draft.format === "groups") && (
        <Group>
          <SwitchRow title={tx.doubleRoundRobin} checked={draft.doubleRoundRobin} onCheckedChange={(doubleRoundRobin) => change({ doubleRoundRobin })} />
        </Group>
      )}
      {draft.format === "groups" && (
        <Group>
          <ChoiceRow title={c.groupsCount} options={options(GROUP_COUNTS)} value={draft.groups.count} onChange={(count) => change({ groups: { ...draft.groups, count } })} />
          <ChoiceRow title={c.groupsAdvance} options={options(ADVANCE)} value={draft.groups.advance} onChange={(advance) => change({ groups: { ...draft.groups, advance } })} />
        </Group>
      )}
      <Group title={c.game} footer={tx.rulesLine(draft.rules.startScore, draft.rules.legsToWin, draft.rules.setsToWin)}>
        <ChoiceRow title={c.startScore} options={options(START_SCORES)} value={draft.rules.startScore} onChange={(startScore) => rules({ startScore })} />
        <ChoiceRow title={c.legs} hint={c.legsHint} options={options(LEGS)} value={draft.rules.legsToWin} onChange={(legsToWin) => rules({ legsToWin })} />
        <ChoiceRow title={c.sets} hint={c.setsHint} options={options(SETS)} value={draft.rules.setsToWin} onChange={(setsToWin) => rules({ setsToWin })} />
        <SwitchRow title={c.doubleOut} checked={draft.rules.doubleOut} onCheckedChange={(doubleOut) => rules({ doubleOut })} />
        <SwitchRow title={c.doubleIn} checked={draft.rules.doubleIn} onCheckedChange={(doubleIn) => rules({ doubleIn })} />
      </Group>
      <Group footer={draft.final ? tx.finalLine(draft.final.legsToWin, draft.final.setsToWin) : undefined}>
        <SwitchRow title={c.final} hint={c.finalHint} checked={draft.final !== null} onCheckedChange={(on) => change({ final: on ? { legsToWin: Math.min(LEGS[LEGS.length - 1], draft.rules.legsToWin + 1), setsToWin: draft.rules.setsToWin } : null })} />
        {draft.final && (
          <>
            <ChoiceRow title={c.finalLegs} options={options(LEGS)} value={draft.final.legsToWin} onChange={(legsToWin) => change({ final: { ...(draft.final as NonNullable<typeof draft.final>), legsToWin } })} />
            <ChoiceRow title={c.finalSets} options={options(SETS)} value={draft.final.setsToWin} onChange={(setsToWin) => change({ final: { ...(draft.final as NonNullable<typeof draft.final>), setsToWin } })} />
          </>
        )}
      </Group>
    </>
  )
}

// Places, guests and boards; how registration, check-in and results run has sensible defaults
// and stays folded away under "Mehr Optionen" (the preview names them).
function PlayersAndBoards({ draft, change }: StepProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  const [guests, setGuests] = useState(draft.guests.join("\n"))
  const [boards, setBoards] = useState(draft.boards.join("\n"))
  const [more, setMore] = useState(false)
  return (
    <>
      <Group footer={c.capacityHint}>
        <ChoiceRow
          title={c.capacity}
          options={CAPACITIES.map((n) => ({ value: n, label: String(n), disabled: draft.format === "roundRobin" && n > MAX_ROUND_ROBIN }))}
          value={draft.capacity}
          onChange={(capacity) => change({ capacity })}
        />
      </Group>
      <TextArea
        label={c.guests}
        hint={c.guestsHint}
        placeholder={c.guestsPlaceholder}
        value={guests}
        onChange={(e) => {
          setGuests(e.target.value)
          change({ guests: e.target.value.split("\n") })
        }}
      />
      <TextArea
        label={c.boards}
        hint={c.boardsHint}
        placeholder={c.boardsPlaceholder}
        value={boards}
        onChange={(e) => {
          setBoards(e.target.value)
          change({ boards: e.target.value.split("\n") })
        }}
      />
      <Group>
        <ListRow title={c.moreOptions} onClick={() => setMore((m) => !m)} chevron={false} trailing={<ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform motion-reduce:transition-none", more && "rotate-180")} aria-hidden="true" />} />
        {more && (
          <>
            <SwitchRow title={c.waitlist} hint={c.waitlistHint} checked={draft.waitlist} onCheckedChange={(waitlist) => change({ waitlist })} />
            <SwitchRow title={c.checkIn} hint={c.checkInHint} checked={draft.checkIn} onCheckedChange={(checkIn) => change({ checkIn })} />
            <ChoiceRow
              title={c.admission}
              options={[
                { value: "auto", label: c.admissionAuto },
                { value: "manual", label: c.admissionManual },
              ]}
              value={draft.admission}
              onChange={(admission) => change({ admission })}
            />
            <ChoiceRow
              title={c.approval}
              options={[
                { value: "organizer", label: c.approvalOrganizer },
                { value: "board", label: c.approvalBoard },
              ]}
              value={draft.approval}
              onChange={(approval) => change({ approval })}
            />
          </>
        )}
      </Group>
      {more && <TextField label={c.registrationCloses} type="datetime-local" value={draft.registrationCloses} onChange={(e) => change({ registrationCloses: e.target.value })} />}
    </>
  )
}

// What will be published, what is missing, and the one button. Publishing founds the
// tournament with the commitment to a draw seed kept on this device, then adds the guests and
// the boards (each board with a key made here, sealed, so its code can be shown).
function Preview({ draft, onPublished }: { draft: TournamentDraft; onPublished: (p: Published) => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  const guest = useInlineProfile()
  const describe = useProblemText()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const problems = useMemo(() => draftProblems(draft), [draft])
  const guests = cleanNames(draft.guests)
  const boards = cleanNames(draft.boards)
  const ready = problems.length === 0 && guest.ready && !busy

  const publish = async () => {
    if (!ready) return
    setBusy(true)
    setProblem(null)
    try {
      if (!(await guest.ensure())) return
      const author = await tournamentAuthor()
      // The seed behind the founding's commitment is kept with the founding, before it can reach
      // anyone; from then on the draft is the tournament, so pressing again never founds twice.
      const seed = createDrawSeed()
      const [founding] = await send(null, [foundTemplate(foundContent(draft, commitSeed(seed)), nowSeconds())], author, { seed: { commit: commitSeed(seed), seed } })
      await deleteDraft(draft.id).catch(() => {})
      const published = { id: founding.id, name: draft.name.trim() }
      const state = reduceTournament([founding], founding.id).state
      try {
        if (!state) throw new Error("the founding does not replay")
        const templates = guests.map((alias) => guestTemplate(state, randomHex(16), alias, false))
        for (const name of boards) {
          const { secretKey } = await createLocalKey()
          const boardId = randomHex(16)
          templates.push(boardTemplate(state, boardId, name, await (await createLocalSigner(secretKey)).getPublicKey()))
          await updateTournament(founding.id, { boardKey: { board: boardId, key: await sealSecret(secretKey, "board-key") } })
        }
        if (templates.length > 0) await send(founding.id, templates, author)
        onPublished({ ...published, incomplete: false })
      } catch {
        // Founded all the same: guests and boards can be added in the organizer's workspace.
        onPublished({ ...published, incomplete: guests.length + boards.length > 0 })
      }
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  const when = draft.starts ? new Date(draft.starts).toLocaleString(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : tx.home.noDate
  return (
    <>
      <Group title={c.summary}>
        <ListRow title={draft.name.trim() || tx.home.untitled} subtitle={[when, draft.online ? tx.home.online : draft.place.trim()].filter(Boolean).join(" · ")} />
        <ListRow title={tx.formats[draft.format].name} subtitle={tx.formats[draft.format].summary} />
        <ListRow title={tx.rulesLine(draft.rules.startScore, draft.rules.legsToWin, draft.rules.setsToWin)} subtitle={draft.final ? tx.finalLine(draft.final.legsToWin, draft.final.setsToWin) : undefined} />
        <ListRow title={c.fieldLine(draft.capacity)} subtitle={[c.guestsCount(guests.length), c.boardsCount(boards.length)].join(" · ")} />
        <ListRow
          title={c.flow}
          subtitle={[
            draft.waitlist ? c.withWaitlist : c.noWaitlist,
            draft.checkIn ? c.withCheckIn : c.noCheckIn,
            draft.admission === "auto" ? c.admissionAuto : c.admissionManual,
            draft.approval === "organizer" ? c.approvalOrganizer : c.approvalBoard,
            ...(draft.registrationCloses ? [c.closesAt(new Date(draft.registrationCloses).toLocaleString(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))] : []),
          ].join(" · ")}
        />
        <ListRow title={c.visibility} subtitle={c.visibilityHint} />
      </Group>
      {problems.length > 0 && (
        <InlineStatus tone="error" className="mt-6">
          <span className="block font-semibold">{c.missing}</span>
          {problems.map((p: DraftProblem) => (
            <span key={p} className="block">
              {c.problems[p]}
            </span>
          ))}
        </InlineStatus>
      )}
      {guest.fields}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Button onClick={() => void publish()} disabled={!ready} className={`${PRIMARY} mt-6`}>
        {busy ? c.publishing : c.publish}
      </Button>
      {guest.dialog}
    </>
  )
}

// The tournament is there: share it now, or go to it.
function PublishedView({ id, name, incomplete }: Published) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const nav = useNav()
  const [sharing, setSharing] = useState(false)
  const open = () => nav.replaceTop(SCREENS.tournamentView, { tournament: id, name })
  return (
    <div className="pb-4">
      <InlineStatus tone="success" className="mt-6">
        <span className="block font-semibold">{tx.create.publishedTitle}</span>
        {tx.create.publishedText}
      </InlineStatus>
      {incomplete && (
        <InlineStatus tone="error" className="mt-4">
          {tx.create.publishedIncomplete}
        </InlineStatus>
      )}
      <Button onClick={() => setSharing(true)} className={`${PRIMARY} mt-6 gap-2`}>
        <Share className="h-5 w-5" aria-hidden="true" />
        {tx.tournament.share}
      </Button>
      <Button variant="ghost" onClick={open} className={`${QUIET} mt-2`}>
        {tx.create.openTournament}
      </Button>
      <ShareSheet open={sharing} onOpenChange={setSharing} tournament={id} name={name} />
    </div>
  )
}
