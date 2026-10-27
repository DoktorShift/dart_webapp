"use client"

import { useEffect, useId, useState } from "react"
import { Gift } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { SwitchRow } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { AmountPicker } from "@/components/payments/amount-picker"
import { ConnectPanel } from "@/components/payments/connect"
import { OutcomeHeader } from "@/components/payments/entry-status"
import { LearnMore } from "@/components/payments/learn-more"
import { PayFlow, type PayRoute } from "@/components/payments/pay-flow"
import { SheetActions } from "@/components/payments/sheet-actions"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useSession } from "@/lib/profile/session"
import { useJournal, useWallet } from "@/lib/payments/hooks"
import { actions, blockingEntry } from "@/lib/payments/journal"
import type { Amount } from "@/lib/payments/money"
import { lookupRecipient, type RecipientLookup } from "@/lib/payments/recipient"

// "Gratulieren" (PLAN.md "Freiwillige Zaps"): a voluntary payment to another player. Amount and
// who will see it are clear before anything is paid; tapping a result or a profile pays nothing.
// Signed in, and with a Lightning address that takes zaps, it can be public (a zap, signed by the
// profile); otherwise, or when the person switches it off, it is a plain payment only the
// recipient sees, never called a public congratulation.

// Offered in bitcoin; in the currency the usual few, two of them chosen to start with.
const PRESETS = [21, 100, 500, 1000] as const
const DEFAULT_FIAT = 2
const MAX_MESSAGE = 140

export function CongratulateFlow({ pubkey, name, action, onDone }: { pubkey: string; name: string; action: string; onDone: () => void }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const c = tx.congratulate
  const messageId = useId()
  const session = useSession()
  const wallet = useWallet()
  const journal = useJournal()
  const [recipient, setRecipient] = useState<RecipientLookup | null>(null)
  const [amount, setAmount] = useState<Amount | null>(null)
  const [publicly, setPublicly] = useState(true)
  const [message, setMessage] = useState("")
  const [route, setRoute] = useState<PayRoute | null>(null)

  useEffect(() => {
    let alive = true
    void lookupRecipient(pubkey).then((found) => alive && setRecipient(found))
    return () => {
      alive = false
    }
  }, [pubkey])

  if (wallet === undefined || journal === undefined || session === undefined) return null
  // Connected, the wallet shows up here by itself and the congratulation goes on.
  if (!wallet) return <ConnectPanel titled onConnected={() => {}} onCancel={onDone} />
  const counterpart = { name, pubkey }
  // A congratulation still open (or the one just made) is shown, not offered again.
  if (route || blockingEntry(journal, action)) return <PayFlow action={action} once={false} counterpart={counterpart} amount={amount} route={route ?? undefined} onDone={onDone} />
  if (!recipient) return <OutcomeHeader tone="progress" working title={tx.pay.findRecipient} />

  const endpoint = recipient.address?.endpoint ?? null
  const zapPossible = !!session && !!endpoint?.zapPubkey
  const zap = zapPossible && publicly

  return (
    <>
      {!endpoint && (
        <InlineStatus className="mb-4">
          {recipient.address ? tx.invoice.addressUnreachable(recipient.address.address) : c.noAddress(name)}
        </InlineStatus>
      )}
      <AmountPicker label={c.amount} bitcoinPresets={PRESETS} defaultFiat={DEFAULT_FIAT} value={amount} onChange={setAmount} />
      {zapPossible && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <SwitchRow title={c.public} checked={publicly} onCheckedChange={setPublicly} />
        </div>
      )}
      {zap && (
        <div className="mt-4">
          <label htmlFor={messageId} className="mb-2 block px-4 text-[0.8125rem] text-muted-foreground">
            {c.message}
          </label>
          <input
            id={messageId}
            value={message}
            maxLength={MAX_MESSAGE}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={c.messagePlaceholder}
            className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-[1.0625rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <p className="mt-3 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{zap ? c.publicHint(name) : c.privateHint(name)}</p>
      <div className="mt-3">
        <LearnMore inline />
      </div>
      <SheetActions>
        <Button
          disabled={amount === null}
          onClick={() => setRoute(endpoint && recipient.address ? (zap ? { kind: "zap", address: recipient.address.address, endpoint, comment: message.trim() } : { kind: "address", address: recipient.address.address, endpoint }) : { kind: "scan" })}
          className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold"
        >
          {t.common.next}
        </Button>
        <Button variant="ghost" onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </SheetActions>
    </>
  )
}

// On another player's public profile ("profile.actions"): "Gratulieren", opening the sheet.
export default function CongratulateAction({ pubkey, name }: { pubkey: string; name: string }) {
  const c = useAreaT(PAYMENTS_TEXTS).congratulate
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <ListRow icon={Gift} iconTone="orange" title={c.button} onClick={() => setOpen(true)} />
      </div>
      <Sheet open={open} onOpenChange={setOpen} title={c.title(name)}>
        <SheetBody>
          {open && <CongratulateFlow pubkey={pubkey} name={name} action={actions.congratulate(pubkey)} onDone={() => setOpen(false)} />}
        </SheetBody>
      </Sheet>
    </>
  )
}
