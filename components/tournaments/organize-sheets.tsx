"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Group, SwitchRow } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PRIMARY, QUIET, scoreText, SECONDARY, useActions, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { useNames } from "@/components/tournaments/use-names"
import { act, type Entry } from "@/components/tournaments/use-tournaments"
import { bytesToHex } from "@noble/hashes/utils"
import { createLocalKey, createLocalSigner } from "@/lib/nostr/signers"
import { openSecret, sealSecret } from "@/lib/profile/vault"
import type { Participant } from "@/lib/protocol/tournament-state"
import { SITE } from "@/lib/site"
import { randomHex } from "@/lib/storage/ids"
import { cleanNames, localTime } from "@/lib/tournaments/draft"
import { createDrawSeed, commitSeed, previewChange, recordResult, recordWalkover, resetMatch, type Consequence, type MatchView, type WalkoverReason } from "@/lib/tournaments/engine"
import { boardLink } from "@/lib/tournaments/links"
import { admitted, drawField, drawPreview, freePlaces, isGuestPlace } from "@/lib/tournaments/read"
import {
  admitTemplate,
  boardTemplate,
  checkInTemplate,
  correctTemplate,
  drawTemplate,
  guestTemplate,
  linkTemplate,
  offerTemplate,
  removeTemplate,
  resultTemplate,
  revokeBoardTemplate,
  seedTemplate,
  updateTemplate,
  waitlistTemplate,
} from "@/lib/tournaments/records"
import { updateTournament } from "@/lib/tournaments/store"
import { cn } from "@/lib/utils"

// The organizer's secondary tasks, each in a sheet over the workspace (HIG: sheets for
// focused tasks): one participant, guests by name, the draw with its preview, one board and
// its code, a new board, one match's result or correction with its consequences, the
// hand-over, and the details.

type Names = ReturnType<typeof useParticipantNames>
type State = NonNullable<Entry["read"]["state"]>

const Problem = ({ text }: { text: string | null }) =>
  text ? (
    <InlineStatus tone="error" className="mt-3">
      {text}
    </InlineStatus>
  ) : null

// What the organizer can do about one place: admit, put on the waiting list, mark as here,
// link a guest place to the profile that claimed it, take out (with why).
export function ParticipantSheet({ entry, names, participant, onOpenChange }: { entry: Entry; names: Names; participant: Participant | null; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const state = entry.read.state as State
  const actions = useActions(entry.read.id)
  const [removing, setRemoving] = useState(false)
  const x = participant && state.participants[participant.id]
  const claimants = useNames(x?.claims ?? [])
  const beforeDraw = state.phase === "registration" || state.phase === "checkin"
  const run = async (what: string, templates: () => Parameters<typeof act>[1]) => {
    if (await actions.run(what, templates)) onOpenChange(false)
  }
  const reasons = Object.keys(p.reasons) as (keyof typeof p.reasons)[]
  return (
    <Sheet open={participant !== null} onOpenChange={onOpenChange} title={participant ? names.nameOf(participant.id) : ""} description={x && isGuestPlace(x) ? p.guest : undefined}>
      {x && (
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
          <Problem text={actions.problem} />
          <div className="mt-2 grid gap-2">
            {beforeDraw && (x.status === "pending" || x.status === "waitlist") && freePlaces(state) > 0 && (
              <Button onClick={() => void run("admit", () => [admitTemplate(state, x.id)])} disabled={actions.busy !== null} className={PRIMARY}>
                {p.admit}
              </Button>
            )}
            {state.phase === "checkin" && x.status === "registered" && !x.checkedIn && (
              <Button onClick={() => void run("checkin", () => [checkInTemplate(state, x.id)])} disabled={actions.busy !== null} className={PRIMARY}>
                {p.checkIn}
              </Button>
            )}
            {beforeDraw && state.settings.waitlist && (x.status === "pending" || x.status === "registered") && (
              <Button variant="secondary" onClick={() => void run("waitlist", () => [waitlistTemplate(state, x.id)])} disabled={actions.busy !== null} className={SECONDARY}>
                {p.toWaitlist}
              </Button>
            )}
            {isGuestPlace(x) && !x.player && (x.claims?.length ?? 0) > 0 && (
              <Group title={p.wantsPlace(x.claims?.length ?? 0)}>
                {x.claims?.map((pubkey) => (
                  <ListRow key={pubkey} title={claimants(pubkey).name ?? names.nameOf(pubkey)} value={p.link(names.nameOf(x.id))} onClick={() => void run("link", () => [linkTemplate(state, x.id, pubkey)])} />
                ))}
              </Group>
            )}
            {x.status !== "removed" && !removing && (
              <Button variant="ghost" onClick={() => setRemoving(true)} disabled={actions.busy !== null} className={cn(QUIET, "text-danger hover:bg-danger/10 hover:text-danger")}>
                {p.remove}
              </Button>
            )}
            {removing && (
              <section>
                <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{p.removeText}</p>
                <ChoiceList label={p.remove} options={reasons.map((r) => ({ value: r, title: p.reasons[r] }))} value={null} onChange={(reason) => void run("remove", () => [removeTemplate(state, x.id, reason)])} />
              </section>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}

// Guests without a profile, by name, one per line.
export function GuestsSheet({ entry, open, onOpenChange }: { entry: Entry; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const state = entry.read.state as State
  const actions = useActions(entry.read.id)
  const [text, setText] = useState("")
  const names = cleanNames(text.split("\n")).slice(0, freePlaces(state))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={p.addGuests} description={tx.create.guestsHint}>
      <label className="sr-only" htmlFor="guest-names">
        {p.guestNames}
      </label>
      <textarea id="guest-names" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx.create.guestsPlaceholder} className="w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-[1.0625rem] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <Problem text={actions.problem} />
      <Button
        onClick={() => void actions.run("guests", () => names.map((alias) => guestTemplate(state, randomHex(16), alias, false))).then((ok) => ok && (setText(""), onOpenChange(false)))}
        disabled={names.length === 0 || actions.busy !== null}
        className={`${PRIMARY} mt-4`}
      >
        {p.add(names.length)}
      </Button>
    </Sheet>
  )
}

// The draw: who is in the field, who is seeded (tapped in order), what it gives, then one
// button. The seed was committed at the founding (or is committed now) and is revealed by
// the draw, so everyone can check the order.
export function DrawSheet({ entry, names, open, onOpenChange }: { entry: Entry; names: Names; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const { read, stored } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [seeded, setSeeded] = useState<string[]>([])
  const field = drawField(state)
  const notPresent = admitted(state).length - field.length
  const preview = drawPreview(state, field, seeded)
  const toggle = (id: string) => setSeeded((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const draw = async () => {
    await actions.run("draw", async () => {
      // A commitment this device made opens with the seed it kept; otherwise a new one is
      // committed first and the draw builds on that record.
      let seed = state.seedCommit ? stored.seeds[state.seedCommit] : undefined
      let base = state
      if (!seed) {
        seed = createDrawSeed()
        await updateTournament(read.id, { seed: { commit: commitSeed(seed), seed } })
        const next = await act(read.id, [seedTemplate(state, seed)])
        if (!next.read.state) throw new Error("the commitment does not replay")
        base = next.read.state
      }
      return [drawTemplate(base, seed, field, seeded)]
    }).then((ok) => ok && onOpenChange(false))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={p.drawTitle} description={p.drawField(field.length)}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {notPresent > 0 && <InlineStatus className="mt-1">{p.drawNotPresent(notPresent)}</InlineStatus>}
        {preview ? <p className="mt-3 text-[1.0625rem] font-semibold">{p.drawPreview(preview.matches, preview.byes)}</p> : <InlineStatus tone="error" className="mt-3">{p.tooFew}</InlineStatus>}
        {preview && preview.byes > 0 && <p className="mt-1 text-[0.9375rem] text-muted-foreground">{tx.seeding.byes}</p>}
        <section className="mt-4">
          <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">
            {p.drawSeeded} · {p.drawSeededHint}
          </p>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {field.map((id) => {
              const place = seeded.indexOf(id)
              return <ListRow key={id} title={names.nameOf(id)} value={place >= 0 ? String(place + 1) : undefined} onClick={() => toggle(id)} chevron={false} className={cn(place >= 0 && "bg-primary/5")} />
            })}
          </div>
        </section>
        <Problem text={actions.problem} />
      </div>
      <Button onClick={() => void draw()} disabled={!preview || actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
        {actions.busy === "draw" ? p.drawing : p.drawConfirm}
      </Button>
    </Sheet>
  )
}

// One board: its code for the device that scores there, and taking it out of the tournament.
export function BoardSheet({ entry, board, onOpenChange }: { entry: Entry; board: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.organize.boards
  const { read, stored } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [link, setLink] = useState<string | null | undefined>(undefined)
  const info = board ? state.boards[board] : undefined
  useEffect(() => {
    if (!board) return
    let current = true
    const sealed = stored.boardKeys[board]
    setLink(undefined)
    if (!sealed) {
      setLink(null)
      return
    }
    void openSecret(sealed, "board-key").then(
      (secret) => current && setLink(boardLink(SITE.url, { tournament: read.id, board, key: bytesToHex(secret) }, read.relays)),
      () => current && setLink(null),
    )
    return () => {
      current = false
    }
  }, [board, stored.boardKeys, read.id, read.relays])
  return (
    <Sheet open={board !== null} onOpenChange={onOpenChange} title={info ? b.codeTitle(info.name) : ""} description={b.codeText}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {link === null && <InlineStatus tone="error">{b.keyLost}</InlineStatus>}
        {link && board && <QRCodeView value={link} caption={b.codeCaption} label={b.codeLabel} maxSize="50dvh" share={{ url: link, title: info?.name }} />}
        <Problem text={actions.problem} />
      </div>
      <div className="mt-2 grid shrink-0 gap-2">
        <Button variant="ghost" onClick={() => board && void actions.run("revoke", () => [revokeBoardTemplate(state, board)]).then((ok) => ok && onOpenChange(false))} disabled={actions.busy !== null} className={cn(QUIET, "text-danger hover:bg-danger/10 hover:text-danger")}>
          {b.revoke}
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)} className={QUIET}>
          {t.common.done}
        </Button>
      </div>
    </Sheet>
  )
}

// A new board: its name; its key is made here and kept sealed, so its code can be shown.
export function AddBoardSheet({ entry, open, onOpenChange }: { entry: Entry; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.organize.boards
  const { read } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [name, setName] = useState("")
  const add = () =>
    actions
      .run("board", async () => {
        const { secretKey } = await createLocalKey()
        const id = randomHex(16)
        await updateTournament(read.id, { boardKey: { board: id, key: await sealSecret(secretKey, "board-key") } })
        return [boardTemplate(state, id, name.trim(), await (await createLocalSigner(secretKey)).getPublicKey())]
      })
      .then((ok) => ok && (setName(""), onOpenChange(false)))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={b.add}>
      <TextField label={b.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={b.namePlaceholder} maxLength={60} autoFocus className="mt-2" />
      <Problem text={actions.problem} />
      <Button onClick={() => void add()} disabled={name.trim() === "" || actions.busy !== null} className={`${PRIMARY} mt-4`}>
        {b.add}
      </Button>
    </Sheet>
  )
}

// One match: enter its result (the winner, and how many legs or sets the loser took), a
// walkover, or correct a result that counts, with what that does to the matches after it.
export function ResultSheet({ entry, names, match: m, onOpenChange }: { entry: Entry; names: Names; match: MatchView | null; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const r = tx.organize.results
  const round = useRoundLabel()
  const { read } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [winner, setWinner] = useState<string | null>(null)
  const [loserCount, setLoserCount] = useState(0)
  const [walkover, setWalkover] = useState<WalkoverReason | null>(null)
  const [reason, setReason] = useState("")
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setWinner(null)
    setLoserCount(0)
    setWalkover(null)
    setReason("")
    setEditing(false)
  }, [m?.id])
  if (!m || !read.bracket) return null
  const players = m.slots.map((s) => s.participant)
  const sets = (m.format.setsToWin ?? 1) > 1
  const toWin = sets ? (m.format.setsToWin as number) : m.format.legsToWin
  const decided = m.state === "finished" || m.state === "walkover"
  const correcting = decided || m.affected
  const form = !decided || editing
  const w = winner !== null ? players.indexOf(winner) : -1
  const score: [number, number] | null = w < 0 ? null : w === 0 ? [toWin, loserCount] : [loserCount, toWin]
  const engineScore = score && (sets ? { legs: [score[0] * m.format.legsToWin, score[1] * m.format.legsToWin] as [number, number], sets: score } : { legs: score })

  // What the change does to the other matches, from the engine, before it is sent.
  let consequences: Consequence[] = []
  if (correcting && winner && read.bracket) {
    try {
      const after = walkover ? recordWalkover(read.bracket, m.id, winner, walkover) : engineScore ? recordResult(read.bracket, m.id, engineScore) : read.bracket
      consequences = previewChange(read.bracket, after).filter((c) => c.match !== m.id)
    } catch {
      consequences = []
    }
  }
  const replayConsequences = m.affected && read.bracket && read.bracket.records[m.id] ? previewChange(read.bracket, resetMatch(read.bracket, m.id)).filter((c) => c.match !== m.id) : []

  const submit = () =>
    actions
      .run("result", () => {
        if (!winner || !score) return []
        if (correcting) return [correctTemplate(state, m.id, winner, walkover ? [0, 0] : score, reason.trim() || r.reason)]
        return [resultTemplate(state, m.id, { winner, score: walkover ? [0, 0] : score, ...(walkover ? { walkover } : {}) })]
      })
      .then((ok) => ok && onOpenChange(false))
  const replay = () => actions.run("replay", () => [correctTemplate(state, m.id, null, [0, 0], reason.trim() || r.replay)]).then((ok) => ok && onOpenChange(false))

  return (
    <Sheet open onOpenChange={onOpenChange} title={`${names.nameOf(players[0])} – ${names.nameOf(players[1])}`} description={`${round(m)} · ${tx.matchNumber(m.number)}`}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {m.affected && <InlineStatus className="mt-1">{r.affected}</InlineStatus>}
        {decided && !editing && (
          <>
            <p className="mt-2 text-[1.5rem] font-semibold">
              {m.state === "walkover" ? tx.walkover[m.walkover ?? "noShow"] : scoreText(m)} · {names.nameOf(m.winner)}
            </p>
            <Button variant="secondary" onClick={() => setEditing(true)} className={`${SECONDARY} mt-4`}>
              {r.correct}
            </Button>
          </>
        )}
        {form && (
          <>
            <section className="mt-2">
              <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{r.winner}</p>
              <ChoiceList label={r.winner} options={players.filter((p): p is string => p !== null).map((p) => ({ value: p, title: names.nameOf(p) }))} value={winner} onChange={setWinner} />
            </section>
            {!walkover && (
              <section className="mt-4">
                <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">
                  {r.score} · {sets ? tx.sets(toWin) : tx.legs(toWin)} : {sets ? tx.sets(loserCount) : tx.legs(loserCount)}
                </p>
                <Segmented label={r.score} options={Array.from({ length: toWin }, (_, i) => ({ value: i, label: String(i) }))} value={loserCount} onChange={setLoserCount} />
              </section>
            )}
            <Group>
              <SwitchRow title={r.walkover} hint={walkover ? tx.walkover[walkover] : undefined} checked={walkover !== null} onCheckedChange={(on) => setWalkover(on ? "noShow" : null)} />
              {walkover && (
                <div className="px-4 py-3">
                  <Segmented
                    label={r.walkover}
                    options={[
                      { value: "noShow", label: tx.walkover.noShow },
                      { value: "retired", label: tx.walkover.retired },
                    ]}
                    value={walkover}
                    onChange={setWalkover}
                  />
                </div>
              )}
            </Group>
            {correcting && <TextField label={r.reason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={r.reasonPlaceholder} maxLength={280} />}
            {correcting && winner && <Consequences list={consequences} names={names} />}
          </>
        )}
        {m.affected && (
          <>
            <Consequences list={replayConsequences} names={names} />
            <Button variant="secondary" onClick={() => void replay()} disabled={actions.busy !== null} className={`${SECONDARY} mt-4`}>
              {r.replay}
            </Button>
          </>
        )}
        <Problem text={actions.problem} />
      </div>
      {form && (
        <Button onClick={() => void submit()} disabled={!winner || actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
          {r.save}
        </Button>
      )}
    </Sheet>
  )
}

function Consequences({ list, names }: { list: Consequence[]; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const r = tx.organize.results
  return (
    <Group title={r.consequences}>
      {list.length === 0 && <ListRow title={r.noConsequences} />}
      {list.map((c) => (
        <ListRow key={c.match} title={`${names.nameOf(c.after[0])} – ${names.nameOf(c.after[1])}`} subtitle={tx.consequence[c.kind]} />
      ))}
    </Group>
  )
}

// Offering the organization to a player with a profile; they take over on their device.
export function HandoverSheet({ entry, names, open, onOpenChange }: { entry: Entry; names: Names; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const s = tx.organize.settings
  const { read } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [to, setTo] = useState<string | null>(null)
  const people = [...new Set(Object.values(state.participants).filter((p) => p.status === "registered").map((p) => (isGuestPlace(p) ? p.player : p.id)).filter((x): x is string => !!x && x !== state.organizer))]
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={s.handover} description={s.handoverText}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {people.length === 0 ? (
          <InlineStatus className="mt-1">{s.handoverNone}</InlineStatus>
        ) : (
          <ChoiceList label={s.handoverTo} options={people.map((p) => ({ value: p, title: names.nameOf(p) }))} value={to} onChange={setTo} className="mt-1" />
        )}
        <Problem text={actions.problem} />
      </div>
      <Button onClick={() => to && void actions.run("offer", () => [offerTemplate(state, to)]).then((ok) => ok && onOpenChange(false))} disabled={!to || actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
        {s.handover}
      </Button>
    </Sheet>
  )
}

// The details that can change after publishing: name, description, venue, start, places.
export function DetailsSheet({ entry, open, onOpenChange }: { entry: Entry; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const c = tx.create
  const { read } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const current = state.settings
  const toLocal = (unix: number | undefined) => (unix === undefined ? "" : new Date(unix * 1000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16))
  const [name, setName] = useState(current.name)
  const [about, setAbout] = useState(current.about ?? "")
  const [place, setPlace] = useState(current.place ?? "")
  const [starts, setStarts] = useState(toLocal(current.starts))
  const [capacity, setCapacity] = useState(String(current.capacity))
  const save = () =>
    actions
      .run("update", () => {
        const cap = Number(capacity)
        const at = localTime(starts)
        return [
          updateTemplate(state, {
            ...(name.trim() !== current.name && name.trim() ? { name: name.trim() } : {}),
            ...(about.trim() !== (current.about ?? "") ? { about: about.trim() } : {}),
            ...(place.trim() !== (current.place ?? "") ? { place: place.trim() } : {}),
            ...(at !== undefined && at !== current.starts ? { starts: at } : {}),
            ...(Number.isInteger(cap) && cap !== current.capacity && cap >= admitted(state).length ? { capacity: cap } : {}),
          }),
        ]
      })
      .then((ok) => ok && onOpenChange(false))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.organize.settings.details}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        <TextField label={c.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-2" />
        <TextField label={c.about} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={500} />
        <TextField label={c.place} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={140} />
        <TextField label={c.starts} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        <TextField label={c.capacity} type="number" inputMode="numeric" min={admitted(state).length} max={128} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <Problem text={actions.problem} />
      </div>
      <Button onClick={() => void save()} disabled={actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
        {tx.organize.settings.save}
      </Button>
    </Sheet>
  )
}
