"use client"

import { useEffect, useMemo, useState } from "react"
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
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { useMediaQuery } from "@/components/common/use-media-query"
import { AmountPicker } from "@/components/payments/amount-picker"
import { CongratulateFlow } from "@/components/payments/congratulate"
import { RequestOriginContext } from "@/components/payments/connect"
import { entryStatus, type Tone } from "@/components/payments/entry-status"
import { useFormat, type Format } from "@/components/payments/format"
import { PayFlow } from "@/components/payments/pay-flow"
import { ReceiveFlow } from "@/components/payments/receive-flow"
import { useLandscapePhone } from "@/components/payments/sheet-actions"
import { PaymentSignet } from "@/components/payments/signet"
import { ResultRow, type ResultRowTone } from "@/components/shell/result-row"
import type { MatchPlayer } from "@/lib/game/types"
import { PAYMENTS_TEXTS, type PaymentTexts } from "@/lib/i18n/features/payments.screens"
import { useSession } from "@/lib/profile/session"
import { useJournal, useReturnedConnection, useWallet } from "@/lib/payments/hooks"
import { actions, isDone, isOpen, noteSettled, type PaymentEntry } from "@/lib/payments/journal"
import { deviceSide, AMOUNT_PRESETS, resultOffer, type StakeParties } from "@/lib/payments/stake"
import type { RequestOrigin } from "@/lib/payments/wallet-return"
import type { SlotListProps } from "@/lib/shell/registry"
import { usePlayers } from "@/lib/storage/hooks"

// The result screen's payment row ("result.actions", one ResultRow with the signet). With a
// stake: "500 sats an Mia zahlen", or how the stake stands, as the row's tone and in its words.
// Without one, only where a wallet is connected: paying, receiving or congratulating. Loaded only
// then (./gate.tsx), so for everyone else the result looks exactly as before. Tapping opens a
// sheet; nothing is paid without its own confirmation.

// How a settled stake stands (./entry-status.tsx) as the row's tone: done, worth a look, or
// nothing special yet.
const ROW_TONES: Record<Tone, ResultRowTone> = { success: "success", progress: "accent", warning: "warning", error: "warning", neutral: "neutral" }

// The profile key each player is linked to on this device, if any.
function useLinked() {
  const players = usePlayers()
  return useMemo(() => {
    const keys = new Map((players ?? []).flatMap((p) => (p.pubkey ? [[p.id, p.pubkey] as const] : [])))
    return (playerId: string) => keys.get(playerId)
  }, [players])
}

// Where the result's row is narrow it says the least, so its words stay on one line: on a phone in
// landscape (the result's left column) and on small phones (iPhone SE, 320 pt wide).
const useBriefRow = () => useMediaQuery("(max-height: 500px), (max-width: 359px)")

// What the stake's row says: how it stands, or what this device can do about it. `brief` where
// the row is narrow.
function stakeLabel(tx: PaymentTexts, format: Format, parties: StakeParties, side: "payer" | "payee" | null, settled: PaymentEntry | undefined, brief: boolean) {
  const s = brief ? tx.stake.brief : tx.stake
  const amount = format.sats(parties.sats)
  if (!settled) return side === "payee" ? s.receiveFrom(amount, parties.payer.name) : s.payTo(amount, parties.payee.name)
  if (settled.via === "manual") return s.settledRow
  if (settled.state === "paid") return s.paidRow(amount, parties.payee.name)
  if (settled.state === "received") return s.receivedRow(amount, parties.payer.name)
  if (settled.state === "unknown") return s.unknownRow
  if (settled.state === "waiting") return s.waitingRow
  return entryStatus(tx, settled).label
}

function StakeAction({ match, placement, parties, entry }: SlotListProps["result.actions"] & { parties: StakeParties; entry: PaymentEntry | undefined }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const format = useFormat()
  const s = tx.stake
  const session = useSession()
  const linked = useLinked()
  const landscape = useLandscapePhone()
  const brief = useBriefRow()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"pay" | "receive" | null>(null)
  const [confirmSettled, setConfirmSettled] = useState(false)
  const amount = format.sats(parties.sats)
  const action = actions.stake(match.id)
  const side = deviceSide(parties, linked, session?.pubkey ?? null)
  const payee = { name: parties.payee.name, pubkey: linked(parties.payee.id) }
  const payer = { name: parties.payer.name, pubkey: linked(parties.payer.id) }

  const settled = entry && (isOpen(entry) || isDone(entry)) ? entry : undefined
  // An earlier payment decides the sheet's side; otherwise this device's side, if known.
  const shown = settled ? (settled.direction === "out" ? "pay" : "receive") : (mode ?? (side === "payer" ? "pay" : side === "payee" ? "receive" : null))
  const close = () => {
    setOpen(false)
    setMode(null)
  }

  // "Wallet-App öffnen" in this sheet names it as the place of the request; the wallet app's
  // answer opens the sheet again on that side, also after a fresh page load.
  const origin = useMemo<RequestOrigin>(() => (shown ? { match: match.id, side: shown } : { match: match.id }), [match.id, shown])
  const returned = useReturnedConnection()
  useEffect(() => {
    if (returned?.from?.match !== match.id) return
    setMode(returned.from.side ?? null)
    setOpen(true)
  }, [returned, match.id])

  return (
    <RequestOriginContext.Provider value={origin}>
      <ResultRow
        icon={PaymentSignet}
        label={stakeLabel(tx, format, parties, side, settled, brief)}
        tone={settled ? ROW_TONES[entryStatus(tx, settled).tone] : "neutral"}
        placement={placement}
        onClick={() => setOpen(true)}
        trailing={{ kind: "chevron" }}
      />
      <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} title={t.payments.stake.title} description={landscape ? undefined : s.agreed(parties.payer.name, amount, parties.payee.name)}>
        <SheetBody>
          {open && shown === "pay" && <PayFlow action={action} once counterpart={payee} amountSats={parties.sats} onDone={close} />}
          {open && shown === "receive" && <ReceiveFlow action={action} once counterpart={payer} amountSats={parties.sats} onDone={close} />}
          {open && shown === null && (
            // Which side this device is on; the two sides share a row on a phone in landscape.
            <div className="grid gap-2 xshort:grid-cols-2">
              <Button onClick={() => setMode("pay")} className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-2 text-[1.0625rem] font-semibold">
                {s.payTo(amount, parties.payee.name)}
              </Button>
              <Button variant="secondary" onClick={() => setMode("receive")} className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-2 text-[1.0625rem] font-semibold text-primary">
                {s.receiveHere(parties.payee.name)}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmSettled(true)} className="h-12 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary xshort:col-span-2">
                {s.settledHere}
              </Button>
            </div>
          )}
        </SheetBody>
        {shown === null && (
          <Button variant="ghost" onClick={close} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
            {t.common.cancel}
          </Button>
        )}
      </Sheet>
      <AlertDialog open={confirmSettled} onOpenChange={setConfirmSettled}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{s.settledHereTitle}</AlertDialogTitle>
            <AlertDialogDescription>{s.settledHereHint}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                void noteSettled({ action, direction: side === "payee" ? "in" : "out", amountMsat: parties.sats * 1000, counterpart: side === "payee" ? payer : payee })
                close()
              }}
            >
              {tx.byHand.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RequestOriginContext.Provider>
  )
}

type FreeChoice = { kind: "pay"; player: MatchPlayer } | { kind: "receive" } | { kind: "congratulate"; player: MatchPlayer; pubkey: string }

function FreeAction({ match, placement }: SlotListProps["result.actions"]) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const f = tx.free
  const session = useSession()
  const linked = useLinked()
  const brief = useBriefRow()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<FreeChoice | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const me = session?.pubkey
  const others = match.players.filter((player) => !me || linked(player.id) !== me)
  const winner = match.players[match.winner]
  const winnerKey = winner ? linked(winner.id) : undefined
  const close = () => {
    setOpen(false)
    setChoice(null)
    setAmount(null)
    setConfirmed(false)
  }

  // A wallet app's answer to a request from this sheet opens it again (see StakeAction).
  const origin = useMemo<RequestOrigin>(() => ({ match: match.id }), [match.id])
  const returned = useReturnedConnection()
  useEffect(() => {
    if (returned?.from?.match === match.id) setOpen(true)
  }, [returned, match.id])

  return (
    <RequestOriginContext.Provider value={origin}>
      <ResultRow icon={PaymentSignet} label={brief ? f.briefButton : f.button} placement={placement} onClick={() => setOpen(true)} trailing={{ kind: "chevron" }} />
      <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} title={choice?.kind === "congratulate" ? tx.congratulate.title(choice.player.name) : f.title}>
        <SheetBody>
          {open && !choice && (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {winner && winnerKey && winnerKey !== me && <ListRow title={tx.congratulate.title(winner.name)} onClick={() => setChoice({ kind: "congratulate", player: winner, pubkey: winnerKey })} />}
              {others.map((player) => (
                <ListRow key={player.id} title={f.payTo(player.name)} onClick={() => setChoice({ kind: "pay", player })} />
              ))}
              <ListRow title={tx.receive.title} onClick={() => setChoice({ kind: "receive" })} />
            </div>
          )}
          {open && choice?.kind === "congratulate" && <CongratulateFlow pubkey={choice.pubkey} name={choice.player.name} action={actions.congratulate(choice.pubkey, match.id)} onDone={close} />}
          {open && choice?.kind === "receive" && <ReceiveFlow action={actions.receiveAfter(match.id)} once={false} counterpart={{ name: "" }} amountSats={null} onDone={close} />}
          {open && choice?.kind === "pay" && !confirmed && (
            <>
              <AmountPicker label={tx.receive.amount} presets={AMOUNT_PRESETS} value={amount} onChange={setAmount} />
              <Button disabled={amount === null} onClick={() => setConfirmed(true)} className="mt-5 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
                {t.common.next}
              </Button>
            </>
          )}
          {open && choice?.kind === "pay" && confirmed && (
            <PayFlow action={actions.payPlayer(match.id, choice.player.id)} once={false} counterpart={{ name: choice.player.name, pubkey: linked(choice.player.id) }} amountSats={amount} onDone={close} />
          )}
        </SheetBody>
        {(!choice || (choice.kind === "pay" && !confirmed)) && (
          <Button variant="ghost" onClick={close} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
            {t.common.cancel}
          </Button>
        )}
      </Sheet>
    </RequestOriginContext.Provider>
  )
}

export default function ResultPayment({ match, placement }: SlotListProps["result.actions"]) {
  const wallet = useWallet()
  const journal = useJournal()
  if (journal === undefined || wallet === undefined) return null
  const offer = resultOffer(match, wallet !== null)
  if (offer?.kind === "stake") return <StakeAction match={match} placement={placement} parties={offer.parties} entry={journal.find((entry) => entry.action === actions.stake(match.id))} />
  if (offer?.kind === "free") return <FreeAction match={match} placement={placement} />
  return null
}
