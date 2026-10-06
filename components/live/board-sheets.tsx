"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { QRCodeView } from "@/components/common/qr-code-view"
import { InlineStatus } from "@/components/common/inline-status"
import { usePublicName } from "@/components/live/use-public-name"
import { useT } from "@/components/i18n-provider"
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
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { modeName, type Messages } from "@/lib/i18n"
import type { SavedMatch } from "@/lib/game/types"
import { seatPlayer, stopHere, type BoardView } from "@/lib/live/board"
import { offerHandoff, type HandoffOffer, type HandoffOfferControl } from "@/lib/live/handoff"
import { openSeating, type Seating } from "@/lib/live/seating"
import { nowSeconds } from "@/lib/nostr/time"
import type { SeatHolder } from "@/lib/protocol/match-state"
import { buildLink } from "@/lib/shell/links"
import { cn } from "@/lib/utils"

// The sheets the live entries of the game menu open over the running game (HIG: sheets for a
// focused task the players can dismiss). Each one makes the game live when it opens (`start`).

const primary = "h-14 w-full rounded-2xl text-[1.0625rem] font-semibold"
const secondary = "h-12 w-full rounded-2xl text-[1.0625rem]"

export interface SheetProps {
  open: boolean
  onClose: () => void
  match: SavedMatch
  view: BoardView | null
  // Makes the game live (once) and resolves when it is.
  start: () => Promise<unknown>
}

const linkFor = (kind: "watch" | "board" | "handoff", payload: string) => buildLink(window.location.origin, kind, payload)
const clock = (t: Messages, seconds: number) => new Date(seconds * 1000).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" })

// Starts the game live when the sheet opens; says so while it works and when it can't.
function useStarted(open: boolean, start: () => Promise<unknown>) {
  const [state, setState] = useState<"starting" | "ready" | "failed">("starting")
  const [attempt, setAttempt] = useState(0)
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (!open) return
    let current = true
    setState("starting")
    startRef.current().then(
      () => current && setState("ready"),
      () => current && setState("failed"),
    )
    return () => {
      current = false
    }
  }, [open, attempt])
  return { state, retry: () => setAttempt((n) => n + 1) }
}

function Starting({ state, retry }: { state: "starting" | "failed"; retry: () => void }) {
  const t = useT()
  if (state === "starting") return <p role="status" className="py-10 text-center text-[0.9375rem] text-muted-foreground">{t.live.preparing}</p>
  return (
    <div className="grid gap-3 pb-2">
      <InlineStatus tone="error">{t.live.startFailed}</InlineStatus>
      <Button onClick={retry} className={primary}>
        {t.live.retry}
      </Button>
    </div>
  )
}

function Done({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" onClick={onClose} className={cn(secondary, "mt-2 shrink-0")}>
      {t.common.done}
    </Button>
  )
}

// ---- Zuschauen lassen ------------------------------------------------------------------------

export function WatchSheet({ open, onClose, match, view, start }: SheetProps) {
  const t = useT()
  const started = useStarted(open, start)
  const game = `${modeName(t, match.config.modeId, match.config.modeName)}, ${match.config.players.map((p) => p.name).join(" – ")}`
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={t.live.watchSheet.title} description={t.live.watchSheet.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {view && started.state === "ready" ? (
          <>
            <QRCodeView
              value={linkFor("watch", view.watch)}
              label={t.live.watchSheet.qrLabel}
              share={{ url: linkFor("watch", view.watch), title: t.live.watchSheet.shareTitle, text: t.live.watchSheet.shareText(game) }}
            />
            <p className="mt-4 px-1 text-[0.8125rem] text-muted-foreground">{t.live.watchSheet.footnote}</p>
          </>
        ) : (
          <Starting state={started.state === "failed" ? "failed" : "starting"} retry={started.retry} />
        )}
      </div>
      <Done onClose={onClose} />
    </Sheet>
  )
}

// ---- Spieler verbinden -----------------------------------------------------------------------

export function PlayersSheet({ open, onClose, match, view, start }: SheetProps) {
  const t = useT()
  const s = t.live.playersSheet
  const started = useStarted(open, start)
  const [seating, setSeating] = useState<Seating | null>(null)
  const [failed, setFailed] = useState(false)
  const [freeing, setFreeing] = useState<number | null>(null)
  const ready = started.state === "ready" && view !== null
  // The board code is answered while the game is on the screen, sheet open or not, and replaced
  // by a fresh one once it has run out.
  useEffect(() => {
    if (!open || !ready || seating) return
    let current = true
    setFailed(false)
    openSeating(match.id).then(
      (next) => (current ? setSeating(next) : next.close()),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [open, ready, seating, match.id])
  useEffect(() => {
    if (!seating) return
    const expiry = setTimeout(() => setSeating(null), Math.max(0, seating.expires - nowSeconds()) * 1000)
    return () => {
      clearTimeout(expiry)
      seating.close()
    }
  }, [seating])

  const names = match.config.players.map((p) => p.name)
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={s.title} description={s.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!ready ? (
          <Starting state={started.state === "failed" ? "failed" : "starting"} retry={started.retry} />
        ) : failed ? (
          <InlineStatus tone="error">{t.live.startFailed}</InlineStatus>
        ) : seating ? (
          <QRCodeView value={linkFor("board", seating.code)} label={s.qrLabel} caption={s.codeValid(clock(t, seating.expires))} />
        ) : (
          <Starting state="starting" retry={started.retry} />
        )}
        {ready && (
          <Group title={s.seats} className="mt-6 first:mt-6">
            {view.seats.map((seat, i) => (
              <SeatRow key={i} name={names[i]} holder={seat.holder} verdict={seat.verdict} onFree={() => setFreeing(i)} />
            ))}
          </Group>
        )}
      </div>
      <Done onClose={onClose} />

      <AlertDialog open={freeing !== null} onOpenChange={(next) => !next && setFreeing(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{freeing !== null ? s.disconnectTitle(names[freeing]) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{s.disconnectText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => freeing !== null && void seatPlayer(match.id, freeing, null)}>
              {s.disconnect}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

function SeatRow({ name, holder, verdict, onFree }: { name: string; holder: SeatHolder | null; verdict: "confirm" | "dispute" | null; onFree: () => void }) {
  const t = useT()
  const s = t.live.playersSheet
  const profile = usePublicName(holder?.profile ? holder.pubkey : null)
  const connection = !holder ? s.notConnected : holder.profile ? (profile?.name ? `${s.connectedProfile}: ${profile.name}` : s.connectedProfile) : s.connectedGuest
  const subtitle: ReactNode = (
    <>
      <span className="block">{connection}</span>
      {verdict && <span className={cn("block", verdict === "dispute" && "text-danger")}>{verdict === "confirm" ? s.confirmed : s.disputed}</span>}
    </>
  )
  return (
    <ListRow
      title={name}
      subtitle={subtitle}
      trailing={
        <span className="flex items-center gap-2">
          {holder && <Avatar seed={holder.pubkey} name={profile?.name ?? name} src={profile?.picture} size={32} />}
          {holder && (
            <Button variant="ghost" onClick={onFree} aria-label={s.disconnectLabel(name)} className="h-11 rounded-xl px-3 text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
              {s.disconnect}
            </Button>
          )}
        </span>
      }
    />
  )
}

// ---- Auf anderem Gerät fortsetzen ------------------------------------------------------------

export function HandoffSheet({ open, onClose, match, start, closeGame }: SheetProps & { closeGame: () => void }) {
  const t = useT()
  const s = t.live.handoffSheet
  const started = useStarted(open, start)
  const [offer, setOffer] = useState<HandoffOffer | null>(null)
  const [round, setRound] = useState(0)
  const control = useRef<HandoffOfferControl | null>(null)
  const ready = started.state === "ready"

  useEffect(() => {
    if (!open || !ready) return
    let current = true
    setOffer(null)
    void offerHandoff(match.id, (next) => current && setOffer(next)).then(
      (made) => {
        if (current) control.current = made
        else made.close()
      },
      () => current && setOffer({ step: "failed", reason: "silent" }),
    )
    return () => {
      current = false
      control.current?.close()
      control.current = null
    }
  }, [open, ready, round, match.id])

  const done = offer?.step === "done"
  const dismiss = done ? closeGame : onClose
  const title = offer?.step === "asked" ? s.askedTitle : done ? s.doneTitle : s.title
  const description = offer?.step === "waiting" ? s.description : offer?.step === "asked" ? s.asked : undefined

  let body: ReactNode
  if (!ready || !offer) body = <Starting state={started.state === "failed" ? "failed" : "starting"} retry={started.retry} />
  else if (offer.step === "waiting")
    body = (
      <>
        <QRCodeView value={linkFor("handoff", offer.code)} label={s.qrLabel} />
        <p className="mt-4 px-1 text-[0.8125rem] text-muted-foreground">{s.footnote}</p>
      </>
    )
  else if (offer.step === "asked")
    body = (
      <div className="grid gap-2 pb-1">
        <CheckCode code={offer.checkCode} />
        <Button onClick={() => control.current?.give()} className={cn(primary, "mt-4")}>
          {s.give}
        </Button>
        <Button variant="secondary" onClick={() => control.current?.decline()} className={secondary}>
          {s.decline}
        </Button>
      </div>
    )
  else if (offer.step === "sending") body = <p role="status" className="py-10 text-center text-[0.9375rem] text-muted-foreground">{s.sending}</p>
  else if (offer.step === "done")
    body = (
      <div className="grid gap-4 pb-1">
        <InlineStatus tone="success">{s.done}</InlineStatus>
        <Button onClick={closeGame} className={primary}>
          {s.close}
        </Button>
      </div>
    )
  else
    body = (
      <div className="grid gap-4 pb-1">
        <InlineStatus tone="error">{offer.reason === "expired" ? s.expired : offer.reason === "too-long" ? s.tooLong : s.silent}</InlineStatus>
        {offer.reason !== "too-long" && (
          <Button onClick={() => setRound((n) => n + 1)} className={primary}>
            {s.again}
          </Button>
        )}
      </div>
    )

  return (
    <Sheet open={open} onOpenChange={(next) => !next && dismiss()} title={title} description={description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      {!done && offer?.step !== "asked" && <Done onClose={onClose} />}
    </Sheet>
  )
}

// The check code both devices show: four digits, a space, four digits, large enough to compare.
export function CheckCode({ code }: { code: string }) {
  const t = useT()
  return (
    <p className="rounded-2xl border border-border bg-card px-4 py-5 text-center">
      <span className="block text-[0.8125rem] text-muted-foreground">{t.live.takeover.checkCode}</span>
      <span className="mt-1 block font-display text-4xl font-semibold tabular-nums tracking-wider">{code}</span>
    </p>
  )
}

// ---- Another device took over ----------------------------------------------------------------

export function MovedSheet({ match, view, closeGame }: { match: SavedMatch; view: BoardView | null; closeGame: () => void }) {
  const t = useT()
  const s = t.live.movedSheet
  const moved = view?.moved ?? null
  return (
    <Sheet open={moved !== null} onOpenChange={() => {}} title={s.title} description={moved ? s.description(moved.here, moved.there) : undefined}>
      <div className="grid gap-2 pb-1">
        <Button onClick={closeGame} className={primary}>
          {s.close}
        </Button>
        <Button variant="secondary" onClick={() => void stopHere(match.id)} className={secondary}>
          {s.keep}
        </Button>
      </div>
    </Sheet>
  )
}
