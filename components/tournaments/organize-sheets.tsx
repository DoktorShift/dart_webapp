"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Confirm } from "@/components/ui/confirm"
import { Group, SwitchRow } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Segmented } from "@/components/ui/segmented"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { SheetCode } from "@/components/common/sheet-code"
import { XSHORT, useMediaQuery } from "@/components/common/use-media-query"
import { useRecentPlayers } from "@/components/common/use-recent-players"
import { useFriends } from "@/components/friends/use-friends"
import { byState } from "@/lib/friends/model"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PRIMARY, QUIET, scoreText, SECONDARY, useActions, useRoundLabel, type Names } from "@/components/tournaments/common"
import { useProfileNames } from "@/components/profile/use-profile-names"
import type { Entry } from "@/components/tournaments/use-tournaments"
import { bytesToHex } from "@noble/hashes/utils"
import type { EventTemplate } from "@/lib/nostr/types"
import { createLocalKey, createLocalSigner } from "@/lib/nostr/signers"
import { openSecret, sealSecret } from "@/lib/profile/vault"
import type { Participant } from "@/lib/protocol/tournament-state"
import { SITE } from "@/lib/site"
import { randomHex } from "@/lib/storage/ids"
import { deliveryStatus } from "@/lib/sync/outbox"
import { cleanNames, localTime } from "@/lib/tournaments/draft"
import { createDrawSeed, commitSeed, previewChange, recordResult, recordWalkover, resetMatch, type Consequence, type MatchView, type WalkoverReason } from "@/lib/tournaments/engine"
import { boardLink } from "@/lib/tournaments/links"
import { admitted, drawField, drawPreview, freePlaces, isGuestPlace, notCheckedIn } from "@/lib/tournaments/read"
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

type State = NonNullable<Entry["read"]["state"]>

const DESTRUCTIVE = cn(QUIET, "text-danger hover:bg-danger/10 hover:text-danger")

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
  const claimants = useProfileNames(x?.claims ?? [])
  const beforeDraw = state.phase === "registration" || state.phase === "checkin"
  const run = async (what: string, templates: () => readonly EventTemplate[]) => {
    if (await actions.run(what, templates)) onOpenChange(false)
  }
  const reasons = Object.keys(p.reasons) as (keyof typeof p.reasons)[]
  return (
    <Sheet open={participant !== null} onOpenChange={onOpenChange} title={participant ? names.nameOf(participant.id) : ""} description={x && isGuestPlace(x) ? p.guest : undefined}>
      {x && (
        <SheetBody>
          <Problem text={actions.problem} />
          <div className="mt-2 grid gap-2">
            {beforeDraw && (x.status === "pending" || x.status === "waitlist") && freePlaces(state) > 0 && (
              <Button onClick={() => void run("admit", () => [admitTemplate(state, x.id)])} disabled={actions.busy !== null} className={PRIMARY}>
                {p.admit}
              </Button>
            )}
            {state.phase === "checkin" && x.status === "registered" && !x.checkedIn && !isGuestPlace(x) && (
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
              <Button variant="ghost" onClick={() => setRemoving(true)} disabled={actions.busy !== null} className={DESTRUCTIVE}>
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
        </SheetBody>
      )}
    </Sheet>
  )
}

// Guests without a profile, by name, one per line. They appear under the names typed here
// (docs/protocol/privacy.md: the organizer's choice), which the hint says.
export function GuestsSheet({ entry, open, onOpenChange }: { entry: Entry; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const state = entry.read.state as State
  const actions = useActions(entry.read.id)
  const [text, setText] = useState("")
  const names = cleanNames(text.split("\n")).slice(0, freePlaces(state))
  // Friends first, then "Zuletzt gespielt mit": one tap adds a name instead of typing it
  // (lib/profile/recent-players.ts). A friend's name comes from their profile.
  const recent = useRecentPlayers({ limit: 8 }).players
  const { friends } = useFriends()
  const friendKeys = friends ? byState(friends, "friend").map((f) => f.pubkey) : []
  const friendNames = useProfileNames(friendKeys)
  const taken = new Set([...Object.values(entry.read.names), ...names].map((n) => n.toLowerCase()))
  const suggestions = [
    ...friendKeys.flatMap((pubkey) => (friendNames(pubkey).name ? [{ pubkey, name: friendNames(pubkey).name as string }] : [])),
    ...recent.filter((r) => !friendKeys.includes(r.pubkey ?? "")),
  ].filter((r) => !taken.has(r.name.toLowerCase()))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={p.addGuests} description={tx.create.guestsHint}>
      <label className="sr-only" htmlFor="guest-names">
        {p.guestNames}
      </label>
      <textarea id="guest-names" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx.create.guestsPlaceholder} className="w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-[1.0625rem] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 px-1 text-[0.8125rem] text-muted-foreground">{p.recent}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((r) => (
              <button
                key={r.pubkey ?? r.name}
                type="button"
                onClick={() => setText((current) => (current.trim() ? `${current.replace(/\s+$/, "")}\n${r.name}` : r.name))}
                className="min-h-11 rounded-full border border-border bg-card px-4 text-[0.9375rem] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/15 [overflow-wrap:anywhere]"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
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

// The draw: who is missing (and one tap to mark them all as here), who is seeded (tapped in
// order), what it gives, then one button. The draw reveals the seed whose commitment players
// saw before: the founding's, kept on this device. A device without that seed (a second device,
// a hand-over, lost data) commits a new one first and draws once relays have it, never both in
// one step (docs/protocol/conflicts.md, "Auslosung ohne vorher bekannten Seed").
export function DrawSheet({ entry, names, open, onOpenChange }: { entry: Entry; names: Names; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.organize.participants
  const { read, stored } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [seeded, setSeeded] = useState<string[]>([])
  const field = drawField(state)
  const missing = notCheckedIn(state)
  const preview = drawPreview(state, field, seeded)
  const seed = state.seedCommit ? stored.seeds[state.seedCommit] : undefined
  const committing = useCommitWaiting(seed !== undefined ? [...state.log.applied].reverse().find((e) => e.type === "tournament.seed")?.id : undefined, entry.waiting)
  const toggle = (id: string) => setSeeded((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const commit = async () => {
    const fresh = createDrawSeed()
    // The seed is kept before its commitment can reach anyone.
    await updateTournament(read.id, { seed: { commit: commitSeed(fresh), seed: fresh } })
    await actions.run("commit", () => [seedTemplate(state, fresh)])
  }
  const draw = () => seed && void actions.run("draw", () => [drawTemplate(state, seed, field, seeded)]).then((ok) => ok && onOpenChange(false))

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={p.drawTitle} description={p.drawField(field.length)}>
      <SheetBody>
        {missing.length > 0 && (
          <div className="mt-1 grid gap-2">
            <InlineStatus>{p.drawMissing(missing.map((x) => names.nameOf(x.id)).join(", "))}</InlineStatus>
            <Button variant="secondary" onClick={() => void actions.run("present", () => missing.map((x) => checkInTemplate(state, x.id)))} disabled={actions.busy !== null} className={SECONDARY}>
              {p.allPresent}
            </Button>
          </div>
        )}
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
        {!seed && <InlineStatus className="mt-4">{p.drawPrepare}</InlineStatus>}
        {committing && <InlineStatus className="mt-4">{p.drawCommitWaiting}</InlineStatus>}
        <Problem text={actions.problem} />
      </SheetBody>
      {seed ? (
        <Button onClick={draw} disabled={!preview || committing || actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
          {actions.busy === "draw" ? p.drawing : p.drawConfirm}
        </Button>
      ) : (
        <Button onClick={() => void commit()} disabled={actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
          {p.drawCommit}
        </Button>
      )}
    </Sheet>
  )
}

// A commitment made on this device is drawn on once relays have it: whether its seed record
// still waits in the outbox (asked again as the tournament's waiting records change).
function useCommitWaiting(record: string | undefined, waiting: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    let current = true
    if (!record) setHeld(false)
    else void deliveryStatus(record).then((status) => current && setHeld(status?.state === "waiting"), () => {})
    return () => {
      current = false
    }
  }, [record, waiting])
  return held
}

// One board: its code for the device that scores there, and taking it out of the tournament
// (asked first: the device there can never report again).
export function BoardSheet({ entry, board, onOpenChange }: { entry: Entry; board: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.organize.boards
  const xshort = useMediaQuery(XSHORT)
  const { read, stored } = entry
  const state = read.state as State
  const actions = useActions(read.id)
  const [link, setLink] = useState<string | null | undefined>(undefined)
  const [revoking, setRevoking] = useState(false)
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
  const revoke = () => board && void actions.run("revoke", () => [revokeBoardTemplate(state, board)]).then((ok) => ok && onOpenChange(false))
  return (
    <Sheet open={board !== null} onOpenChange={onOpenChange} title={info ? b.codeTitle(info.name) : ""} description={xshort ? undefined : b.codeText}>
      <SheetBody>
        {link === null && <InlineStatus tone="error">{b.keyLost}</InlineStatus>}
        {link && board && <SheetCode value={link} label={b.codeLabel} description={b.codeText} share={{ url: link, title: info?.name }} />}
        <Problem text={actions.problem} />
        <Button variant="ghost" onClick={() => setRevoking(true)} disabled={actions.busy !== null} className={`${DESTRUCTIVE} mt-2`}>
          {b.revoke}
        </Button>
      </SheetBody>
      <Button variant="ghost" onClick={() => onOpenChange(false)} className={`${QUIET} mt-2 shrink-0`}>
        {t.common.done}
      </Button>
      <Confirm open={revoking} onOpenChange={setRevoking} title={b.revokeTitle(info?.name ?? "")} text={b.revokeText} confirm={b.revoke} destructive onConfirm={revoke} />
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

// One match: enter its result (the winner, and how many legs or sets the loser took) or a
// walkover, or correct a result that counts (filled in with it), with what that does to the
// matches after it. A match a correction left without fitting players shows its new pairing:
// enter the result it got, or have it played again. A walkover the bracket made from a
// withdrawal (or a bye) takes no result while the player is out: it only says so, and a result
// entered for it anyway can be taken back.
export function ResultSheet({ entry, names, match: m, onOpenChange }: { entry: Entry; names: Names; match: MatchView | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
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
  const decided = m?.state === "finished" || m?.state === "walkover"
  // A correction starts from what counts now.
  useEffect(() => {
    const side = m?.winner ? m.slots.findIndex((s) => s.participant === m.winner) : -1
    const sets = (m?.format.setsToWin ?? 1) > 1
    const lost = side < 0 || !m?.score ? 0 : ((sets ? m.score.sets?.[1 - side] : m.score.legs[1 - side]) ?? 0)
    setWinner(decided ? (m?.winner ?? null) : null)
    setLoserCount(decided ? lost : 0)
    setWalkover(decided && m?.state === "walkover" && (m.walkover === "noShow" || m.walkover === "retired") ? m.walkover : null)
    setReason("")
    setEditing(false)
    // Once per match opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id])
  if (!m || !read.bracket) return null
  const bracket = read.bracket
  const players = m.slots.map((s) => s.participant)
  const sets = (m.format.setsToWin ?? 1) > 1
  const toWin = sets ? (m.format.setsToWin as number) : m.format.legsToWin
  const correcting = (state.slots[m.id]?.approved ?? null) !== null
  const automatic = m.state === "walkover" && (m.walkover === "withdrawn" || m.walkover === "bye") && !bracket.records[m.id]
  const form = !automatic && (editing || (!decided && !m.affected))
  const skipped = read.skipped.some((x) => x.slot === m.id)
  const w = winner !== null ? players.indexOf(winner) : -1
  const score: [number, number] | null = w < 0 ? null : w === 0 ? [toWin, loserCount] : [loserCount, toWin]
  const engineScore = score && (sets ? { legs: [score[0] * m.format.legsToWin, score[1] * m.format.legsToWin] as [number, number], sets: score } : { legs: score })

  // What the change does to the other matches, from the engine, before it is sent.
  const consequencesOf = (after: () => typeof bracket): Consequence[] => {
    try {
      return previewChange(bracket, after()).filter((c) => c.match !== m.id)
    } catch {
      return []
    }
  }
  const consequences = correcting && form && winner ? consequencesOf(() => (walkover ? recordWalkover(bracket, m.id, winner, walkover) : engineScore ? recordResult(bracket, m.id, engineScore) : bracket)) : []
  const replayConsequences = m.affected && !form && bracket.records[m.id] ? consequencesOf(() => resetMatch(bracket, m.id)) : []

  const submit = () =>
    actions
      .run("result", () => {
        if (!winner || !score) return []
        const entered: [number, number] = walkover ? [0, 0] : score
        if (correcting) return [correctTemplate(state, m.id, winner, entered, reason.trim() || r.reason, walkover ?? undefined)]
        return [resultTemplate(state, m.id, { winner, score: entered, ...(walkover ? { walkover } : {}) })]
      })
      .then((ok) => ok && onOpenChange(false))
  const replay = () => actions.run("replay", () => [correctTemplate(state, m.id, null, [0, 0], reason.trim() || r.replay)]).then((ok) => ok && onOpenChange(false))
  const takeBack = () => actions.run("takeBack", () => [correctTemplate(state, m.id, null, [0, 0], r.takeBack)]).then((ok) => ok && onOpenChange(false))

  return (
    <Sheet open onOpenChange={onOpenChange} title={`${names.nameOf(players[0])} – ${names.nameOf(players[1])}`} description={`${round(m)} · ${tx.matchNumber(m.number)}`}>
      <SheetBody>
        {m.affected && <InlineStatus className="mt-1">{r.affected}</InlineStatus>}
        {skipped && <InlineStatus className="mt-1">{automatic ? r.skippedWalkover : r.skipped}</InlineStatus>}
        {decided && !m.affected && !editing && (
          <p className="mt-2 text-[1.5rem] font-semibold [overflow-wrap:anywhere]">
            {m.state === "walkover" ? tx.walkover[m.walkover ?? "noShow"] : scoreText(m)} · {names.nameOf(m.winner)}
          </p>
        )}
        {m.affected && !form && <Consequences list={replayConsequences} names={names} />}
        {form && (
          <>
            <section className="mt-2">
              <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{r.winner}</p>
              <ChoiceList label={r.winner} options={players.filter((p): p is string => p !== null).map((p) => ({ value: p, title: names.nameOf(p) }))} value={winner} onChange={setWinner} />
            </section>
            {!walkover && toWin > 1 && (
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
        <Problem text={actions.problem} />
      </SheetBody>
      <div className="mt-4 grid shrink-0 gap-2">
        {automatic ? (
          skipped && correcting ? (
            <Button variant="secondary" onClick={() => void takeBack()} disabled={actions.busy !== null} className={SECONDARY}>
              {r.takeBack}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} className={QUIET}>
              {t.common.done}
            </Button>
          )
        ) : form ? (
          <Button onClick={() => void submit()} disabled={!winner || actions.busy !== null} className={PRIMARY}>
            {r.save}
          </Button>
        ) : m.affected ? (
          <Button onClick={() => setEditing(true)} className={PRIMARY}>
            {r.enter}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)} className={SECONDARY}>
            {r.correct}
          </Button>
        )}
        {m.affected && !form && correcting && (
          <Button variant="secondary" onClick={() => void replay()} disabled={actions.busy !== null} className={SECONDARY}>
            {r.replay}
          </Button>
        )}
      </div>
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
      <SheetBody>
        {people.length === 0 ? (
          <InlineStatus className="mt-1">{s.handoverNone}</InlineStatus>
        ) : (
          <ChoiceList label={s.handoverTo} options={people.map((p) => ({ value: p, title: names.nameOf(p) }))} value={to} onChange={setTo} className="mt-1" />
        )}
        <Problem text={actions.problem} />
      </SheetBody>
      {people.length > 0 && (
        <Button onClick={() => to && void actions.run("offer", () => [offerTemplate(state, to)]).then((ok) => ok && onOpenChange(false))} disabled={!to || actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
          {s.handover}
        </Button>
      )}
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
      <SheetBody>
        <TextField label={c.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-2" />
        <TextField label={c.about} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={500} />
        <TextField label={c.place} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={140} />
        <TextField label={c.starts} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        <TextField label={c.capacity} type="number" inputMode="numeric" min={admitted(state).length} max={128} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <Problem text={actions.problem} />
      </SheetBody>
      <Button onClick={() => void save()} disabled={actions.busy !== null} className={`${PRIMARY} mt-4 shrink-0`}>
        {tx.organize.settings.save}
      </Button>
    </Sheet>
  )
}
