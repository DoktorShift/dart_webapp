"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Smartphone } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { Button } from "@/components/ui/button"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { OutcomeHeader } from "@/components/payments/entry-status"
import { problemText } from "@/components/payments/problem"
import { PaymentSignet } from "@/components/payments/signet"
import { capabilityText, WalletCard, WalletRights } from "@/components/payments/wallet-details"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useWallet } from "@/lib/payments/hooks"
import { scanKind } from "@/lib/payments/invoices"
import { checkWallet, connectNewWallet, keepWallet, type CheckedWallet, type WalletInfo } from "@/lib/payments/wallet"
import { forgetReturnedConnection, returnedConnection, walletAppLink } from "@/lib/payments/wallet-return"
import type { ScreenProps } from "@/lib/shell/registry"

// "Wallet verbinden" (PLAN.md: "Wallet verbinden" → QR scannen oder Verbindung einfügen →
// Rechte prüfen → "Verbunden"). The scanner takes only a wallet connection and names an invoice
// for what it is. On a phone, a wallet app on the same device can create the connection and come
// back (lib/payments/wallet-return.ts); what it sends is shown for the person to confirm before
// anything is kept. Used as a screen in Zahlungen and inside the payment sheets (there `titled`,
// under the sheet's own title), so a payment that needed a wallet carries on right after.
export function ConnectPanel({ onConnected, onCancel, titled = false }: { onConnected: (info: WalletInfo) => void; onCancel?: () => void; titled?: boolean }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const c = tx.connect
  const [connecting, setConnecting] = useState(false)
  const [withApps, setWithApps] = useState(false)
  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  })

  // Only phones and tablets have wallet apps to open; known only in the browser.
  useEffect(() => {
    setWithApps(window.matchMedia("(pointer: coarse)").matches)
  }, [])

  // A message when it didn't work, nothing when connected.
  const connect = useCallback(
    async (uri: string): Promise<string | undefined> => {
      setConnecting(true)
      try {
        onConnectedRef.current(await connectNewWallet(uri))
      } catch (error) {
        return problemText(tx, error)
      } finally {
        setConnecting(false)
      }
    },
    [tx],
  )

  const onResult = (text: string): ScanVerdict | Promise<ScanVerdict> => {
    const kind = scanKind(text)
    if (kind === "invoice") return c.isInvoice
    if (kind !== "wallet") return c.notWallet
    return connect(text)
  }

  return (
    <div className="flex flex-col">
      {titled && (
        <div className="mb-2 flex items-center gap-3">
          <PaymentSignet />
          <h3 className="text-[1.0625rem] font-semibold leading-snug">{t.payments.connectTitle}</h3>
        </div>
      )}
      <p className="text-[1.0625rem] leading-snug text-muted-foreground">{c.intro}</p>
      <QRScanner className="mt-5" onResult={onResult} manualLabel={c.manualLabel} manualPlaceholder={c.manualPlaceholder} />
      {connecting && <InlineStatus className="mt-3">{c.connecting}</InlineStatus>}
      {withApps && (
        <div className="mt-6">
          {/* A new request each time: only its answer is taken (lib/payments/wallet-return.ts). */}
          <Button
            variant="secondary"
            onClick={() => window.location.assign(walletAppLink(window.location.origin))}
            className="h-12 w-full gap-2 whitespace-normal rounded-xl text-[1.0625rem] font-semibold text-primary"
          >
            <Smartphone className="h-5 w-5 shrink-0" aria-hidden="true" />
            {c.openApp}
          </Button>
          <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{c.openAppHint}</p>
        </div>
      )}
      <p className="mt-6 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{c.namesDiffer}</p>
      <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.wallet.privacy}</p>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      )}
    </div>
  )
}

// "Verbunden", with what the wallet allows.
export function ConnectedView({ info }: { info: WalletInfo }) {
  const tx = useAreaT(PAYMENTS_TEXTS)
  return (
    <>
      <OutcomeHeader tone="success" title={tx.connect.connected} text={`${info.alias ?? tx.yourWallet} · ${capabilityText(tx, info)}`} />
      <WalletRights info={info} figures />
    </>
  )
}

// "Diese Wallet verbinden?": the connection a wallet app sent back, checked with the wallet and
// shown with its name and rights, kept only when the person confirms. Says when it would replace
// the wallet connected now.
function ConfirmReturned({ uri, onConnected, onDismiss }: { uri: string; onConnected: (info: WalletInfo) => void; onDismiss: () => void }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const c = tx.connect
  const current = useWallet()
  const [checked, setChecked] = useState<CheckedWallet | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [keeping, setKeeping] = useState(false)

  useEffect(() => {
    let alive = true
    checkWallet(uri).then(
      (wallet) => alive && setChecked(wallet),
      (error) => alive && setProblem(problemText(tx, error)),
    )
    return () => {
      alive = false
    }
  }, [uri, tx])

  const keep = async (wallet: CheckedWallet) => {
    setKeeping(true)
    try {
      onConnected(await keepWallet(wallet))
    } catch (error) {
      setProblem(problemText(tx, error))
      setKeeping(false)
    }
  }

  if (!checked) {
    return (
      <>
        {problem ? (
          <InlineStatus tone="error">{problem}</InlineStatus>
        ) : (
          <OutcomeHeader tone="progress" working title={c.checking} />
        )}
        <Button variant="ghost" onClick={onDismiss} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </>
    )
  }
  return (
    <>
      <h2 className="mt-2 text-xl font-semibold leading-tight">{c.confirmTitle}</h2>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{c.confirmText}</p>
      <WalletCard info={checked.info} />
      <WalletRights info={checked.info} />
      {current && <InlineStatus className="mt-6">{c.replaces(current.alias ?? "")}</InlineStatus>}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Button onClick={() => void keep(checked)} disabled={keeping} className="mt-8 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {c.confirm}
      </Button>
      <Button variant="ghost" onClick={onDismiss} className="mt-2 h-12 w-full rounded-xl text-[1.0625rem]">
        {t.common.cancel}
      </Button>
    </>
  )
}

// Zahlungen › Wallet verbinden. Opened by a wallet app's answer too (params.returned): one to this
// device's request is shown for confirmation, any other is refused and said so.
export default function ConnectScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const nav = useNav()
  const [returned] = useState(() => (params.returned === "connection" ? returnedConnection() : null))
  const [connected, setConnected] = useState<WalletInfo | null>(null)

  // The connection lives on in this screen only.
  useEffect(() => forgetReturnedConnection(), [])

  if (connected) {
    return (
      <>
        <ConnectedView info={connected} />
        <Button onClick={() => nav.pop()} className="mt-8 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {t.common.done}
        </Button>
      </>
    )
  }
  if (returned) return <ConfirmReturned uri={returned} onConnected={setConnected} onDismiss={() => nav.pop()} />
  return (
    <>
      <PaymentSignet size="large" className="mx-auto mb-5 mt-2 flex w-fit" />
      {params.returned === "unrequested" && (
        <InlineStatus tone="error" className="mb-5">
          {tx.connect.unrequested}
        </InlineStatus>
      )}
      <ConnectPanel onConnected={setConnected} />
    </>
  )
}
