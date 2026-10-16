"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { QRCodeView } from "@/components/common/qr-code-view"
import { InlineStatus } from "@/components/common/inline-status"
import { ShareActions } from "@/components/common/share-actions"
import { XSHORT, useMediaQuery } from "@/components/common/use-media-query"
import { gameHandedOver } from "@/components/live/gate"
import { sameNamed, shortKey, usePublicNames, type PublicName } from "@/components/live/use-public-names"
import { Waiting } from "@/components/live/waiting"
import { useAreaT, useT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
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
// A code in a sheet leaves room for the share buttons below it (and a caption), even on an
// iPhone SE (548 pt).
const QR_IN_SHEET = "32dvh"

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
  const tx = useAreaT(LIVE_TEXTS)
  if (state === "starting") return <Waiting className="py-10">{tx.preparing}</Waiting>
  return (
    <div className="grid gap-3 pb-2">
      <InlineStatus tone="error">{tx.startFailed}</InlineStatus>
      <Button onClick={retry} className={primary}>
        {tx.retry}
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

// The code with what goes with it. On a phone in landscape (xshort) a sheet has about 140 pt
// for its body: the code sits on the left, smaller, and on the right what must stay in view
// without a scroll: the description (`description`, shown in the sheet's header elsewhere),
// the share buttons, and `children` (the seats); the caption gives way. Elsewhere everything
// stands below the code.
function CodeWithActions({
  value,
  label,
  caption,
  description,
  share,
  children,
}: {
  value: string
  label: string
  caption?: string
  description?: string
  share: { url: string; title?: string; text?: string }
  children?: ReactNode
}) {
  const xshort = useMediaQuery(XSHORT)
  if (!xshort)
    return (
      <>
        <QRCodeView value={value} label={label} caption={caption} share={share} maxSize={QR_IN_SHEET} />
        {children}
      </>
    )
  return (
    <div className="flex items-start gap-4">
      {/* The code's size is set here, not by the figure's own cap, so the column beside it keeps its room. */}
      <div className="w-[45dvh] shrink-0">
        <QRCodeView value={value} label={label} className="w-full" />
      </div>
      <div className="min-w-0 flex-1">
        {description && <p className="mb-3 text-[0.9375rem] leading-snug text-muted-foreground">{description}</p>}
        <ShareActions url={share.url} title={share.title} text={share.text} />
        {children}
      </div>
    </div>
  )
}

// ---- Zuschauen lassen ------------------------------------------------------------------------

export function WatchSheet({ open, onClose, match, view, start }: SheetProps) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const xshort = useMediaQuery(XSHORT)
  const started = useStarted(open, start)
  const game = `${modeName(t, match.config.modeId, match.config.modeName)}, ${match.config.players.map((p) => p.name).join(" – ")}`
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={tx.watchSheet.title} description={xshort ? undefined : tx.watchSheet.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {view && started.state === "ready" ? (
          <CodeWithActions
            value={linkFor("watch", view.watch)}
            label={tx.watchSheet.qrLabel}
            description={tx.watchSheet.description}
            share={{ url: linkFor("watch", view.watch), title: tx.watchSheet.shareTitle, text: tx.watchSheet.shareText(game) }}
          />
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
  const tx = useAreaT(LIVE_TEXTS)
  const s = tx.playersSheet
  const xshort = useMediaQuery(XSHORT)
  const started = useStarted(open, start)
  const [seating, setSeating] = useState<Seating | null>(null)
  const [failed, setFailed] = useState(false)
  const [round, setRound] = useState(0)
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
  }, [open, ready, seating, round, match.id])
  useEffect(() => {
    if (!seating) return
    const expiry = setTimeout(() => setSeating(null), Math.max(0, seating.expires - nowSeconds()) * 1000)
    return () => {
      clearTimeout(expiry)
      seating.close()
    }
  }, [seating])

  const names = match.config.players.map((p) => p.name)
  const holders = view?.seats.map((seat) => seat.holder) ?? []
  const profiles = usePublicNames(holders.map((h) => (h?.profile ? h.pubkey : null)))
  // The name each connected phone shows: its profile's, else the seat's.
  const shown = holders.map((h, i) => (h ? (profiles.get(h.pubkey)?.name ?? names[i]) : null))
  const twins = sameNamed(holders.flatMap((h, i) => (h ? [{ pubkey: h.pubkey, name: shown[i] as string }] : [])))
  const boardLink = seating ? linkFor("board", seating.code) : null
  // On a phone in landscape the seats stand beside the code, right under the share buttons, so
  // the first of them is in view: the description, the caption and the group's title step aside.
  const seats = ready && (
    <Group title={xshort ? undefined : s.seats} className={cn("mt-6 first:mt-6", xshort && "mt-3 first:mt-0")}>
      {view.seats.map((seat, i) => (
        <SeatRow
          key={i}
          name={names[i]}
          holder={seat.holder}
          profile={seat.holder ? (profiles.get(seat.holder.pubkey) ?? null) : null}
          twin={seat.holder !== null && twins.has(seat.holder.pubkey)}
          verdict={seat.verdict}
          onFree={() => setFreeing(i)}
        />
      ))}
    </Group>
  )
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={s.title} description={xshort ? undefined : s.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!ready ? (
          <Starting state={started.state === "failed" ? "failed" : "starting"} retry={started.retry} />
        ) : failed ? (
          <Starting state="failed" retry={() => setRound((n) => n + 1)} />
        ) : boardLink && seating ? (
          <CodeWithActions value={boardLink} label={s.qrLabel} caption={s.codeValid(clock(t, seating.expires))} share={{ url: boardLink, title: s.title }}>
            {seats}
          </CodeWithActions>
        ) : (
          <>
            <Starting state="starting" retry={started.retry} />
            {seats}
          </>
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

// A seat: the board's name, how a phone is connected to it (with the profile's own name and
// picture, and the key's first characters when another connected player shows the same name),
// and the player's verdict on the result.
function SeatRow({
  name,
  holder,
  profile,
  twin,
  verdict,
  onFree,
}: {
  name: string
  holder: SeatHolder | null
  profile: PublicName | null
  twin: boolean
  verdict: "confirm" | "dispute" | null
  onFree: () => void
}) {
  const tx = useAreaT(LIVE_TEXTS)
  const s = tx.playersSheet
  const connection = !holder ? s.notConnected : holder.profile ? (profile?.name ? s.connectedAs(profile.name) : s.connectedProfile) : s.connectedGuest
  const subtitle: ReactNode = (
    <>
      <span className="block">{connection}</span>
      {holder && twin && <span className="block tabular-nums">{s.keyHint(shortKey(holder.pubkey))}</span>}
      {verdict && <span className={cn("block", verdict === "dispute" && "text-danger")}>{verdict === "confirm" ? s.confirmed : s.disputed}</span>}
    </>
  )
  return (
    <ListRow
      title={name}
      subtitle={subtitle}
      trailing={
        holder && (
          <span className="flex items-center gap-1">
            <Avatar seed={holder.pubkey} name={profile?.name ?? name} src={profile?.picture} size={32} />
            <Button variant="ghost" onClick={onFree} aria-label={s.disconnectLabel(name)} className="h-11 rounded-xl px-3 text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
              {s.disconnect}
            </Button>
          </span>
        )
      }
    />
  )
}

// ---- Auf anderem Gerät fortsetzen ------------------------------------------------------------

export function HandoffSheet({ open, onClose, match, start, closeGame }: SheetProps & { closeGame: () => void }) {
  const tx = useAreaT(LIVE_TEXTS)
  const s = tx.handoffSheet
  const xshort = useMediaQuery(XSHORT)
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

  // The other device has the game: this one leaves it at once, so nothing here can keep or
  // save it any more, and says so on the Play tab (components/live/joined-rows.tsx).
  useEffect(() => {
    if (offer?.step !== "done") return
    gameHandedOver()
    closeGame()
  }, [offer, closeGame])

  // From "Übergeben" on, the other device may have the game at any moment: the sheet stays until
  // it says so or the wait for it runs out.
  const locked = offer?.step === "sending" || offer?.step === "done"
  const title = offer?.step === "asked" ? s.askedTitle : s.title
  const description = offer?.step === "waiting" ? (xshort ? undefined : s.description) : offer?.step === "asked" ? s.asked : undefined

  let body: ReactNode
  if (!ready || !offer) body = <Starting state={started.state === "failed" ? "failed" : "starting"} retry={started.retry} />
  else if (offer.step === "waiting")
    body = <CodeWithActions value={linkFor("handoff", offer.code)} label={s.qrLabel} description={s.description} share={{ url: linkFor("handoff", offer.code), title: s.title }} />
  else if (offer.step === "asked")
    // Side by side on a phone in landscape, so both buttons stay in view with the code.
    body = (
      <div className="grid gap-4 pb-1 xshort:grid-cols-2 xshort:items-center">
        <CheckCode code={offer.checkCode} />
        <div className="grid gap-2">
          <Button onClick={() => control.current?.give()} className={primary}>
            {s.give}
          </Button>
          <Button variant="secondary" onClick={() => control.current?.decline()} className={secondary}>
            {s.decline}
          </Button>
        </div>
      </div>
    )
  else if (locked) body = <Waiting className="py-10">{s.sending}</Waiting>
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
    <Sheet open={open} dismissible={!locked} onOpenChange={(next) => !next && onClose()} title={title} description={description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      {!locked && offer?.step !== "asked" && <Done onClose={onClose} />}
    </Sheet>
  )
}

// The check code both devices show: four digits, a space, four digits, large enough to compare.
export function CheckCode({ code }: { code: string }) {
  const tx = useAreaT(LIVE_TEXTS)
  return (
    <p className="rounded-2xl border border-border bg-card px-4 py-5 text-center">
      <span className="block text-[0.8125rem] text-muted-foreground">{tx.takeover.checkCode}</span>
      <span className="mt-1 block font-display text-4xl font-semibold tabular-nums tracking-wider">{code}</span>
    </p>
  )
}

// ---- Another device took over ----------------------------------------------------------------

export function MovedSheet({ match, view, closeGame }: { match: SavedMatch; view: BoardView | null; closeGame: () => void }) {
  const tx = useAreaT(LIVE_TEXTS)
  const s = tx.movedSheet
  const moved = view?.moved ?? null
  return (
    <Sheet open={moved !== null} dismissible={false} onOpenChange={() => {}} title={s.title} description={moved ? s.description(moved.here, moved.there) : undefined}>
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
