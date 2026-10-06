"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
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
import { useReturnedConnection, useWallet } from "@/lib/payments/hooks"
import { scanKind } from "@/lib/payments/invoices"
import { checkWallet, connectNewWallet, keepWallet, type CheckedWallet, type WalletInfo } from "@/lib/payments/wallet"
import { forgetReturnedConnection, walletAppLink, watchReturns, type RequestOrigin } from "@/lib/payments/wallet-return"
import type { ScreenProps } from "@/lib/shell/registry"

// "Wallet verbinden" (PLAN.md: "Wallet verbinden" → QR scannen oder Verbindung einfügen →
// Rechte prüfen → "Verbunden"). The scanner takes only a wallet connection and names an invoice
// for what it is. On a phone, a wallet app on the same device can create the connection and come
// back (lib/payments/wallet-return.ts); what it sends is shown for the person to confirm before
// anything is kept. Used as a screen in Zahlungen and inside the payment sheets (there `titled`,
// under the sheet's own title), so a payment that needed a wallet carries on right after.

// Where a panel's "Wallet-App öffnen" request is made: a result's payment sheet names its game
// and side, so the wallet app's answer opens that sheet again, also after a fresh page load.
// Without it the connect screen shows the answer (./register.ts).
export const RequestOriginContext = createContext<RequestOrigin | null>(null)

export function ConnectPanel({ onConnected, onCancel, titled = false }: { onConnected: (info: WalletInfo) => void; onCancel?: () => void; titled?: boolean }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const c = tx.connect
  const origin = useContext(RequestOriginContext)
  const returned = useReturnedConnection()
  const [connecting, setConnecting] = useState(false)
  const [withApps, setWithApps] = useState(false)
  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  })

  // While on screen, the panel shows a wallet app's answer by itself.
  useEffect(() => watchReturns(), [])

  // Only phones and tablets have wallet apps to open; known only in the browser.
  useEffect(() => {
    setWithApps(window.matchMedia("(pointer: coarse)").matches)
  }, [])

  // The wallet is kept: the panel stays busy until whatever showed it goes on.
  const finish = useCallback((info: WalletInfo) => {
    setConnecting(true)
    onConnectedRef.current(info)
  }, [])

  // A message when it didn't work, nothing when connected.
  const connect = useCallback(
    async (uri: string): Promise<string | undefined> => {
      setConnecting(true)
      try {
        finish(await connectNewWallet(uri))
      } catch (error) {
        setConnecting(false)
        return problemText(tx, error)
      }
    },
    [finish, tx],
  )

  const onResult = (text: string): ScanVerdict | Promise<ScanVerdict> => {
    const kind = scanKind(text)
    if (kind === "invoice") return c.isInvoice
    if (kind !== "wallet") return c.notWallet
    return connect(text)
  }

  if (returned) return <ConfirmReturned uri={returned.uri} onConnected={finish} onDismiss={forgetReturnedConnection} />

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
            onClick={() => window.location.assign(walletAppLink(window.location.origin, origin))}
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
// the wallet connected now. The answer is let go once it is kept or dismissed.
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
      onDismiss()
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

// Zahlungen › Wallet verbinden. A wallet app's answer shows up in the panel by itself; one nobody
// asked for here is refused and said so (params.returned, and with a wallet connected nothing
// else is offered). Once a wallet is connected, here or in another tab, it shows "Verbunden".
export default function ConnectScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const nav = useNav()
  const wallet = useWallet()
  const returned = useReturnedConnection()
  const [connected, setConnected] = useState<WalletInfo | null>(null)
  const refused = params.returned === "unrequested" && !connected
  if (wallet === undefined) return null

  // Not while an answer still waits to be confirmed: it may replace the wallet connected now.
  const shown = connected ?? (returned ? null : wallet)
  if (shown && !refused) {
    return (
      <>
        <ConnectedView info={shown} />
        <Button onClick={() => nav.pop()} className="mt-8 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {t.common.done}
        </Button>
      </>
    )
  }
  return (
    <>
      <PaymentSignet size="large" className="mx-auto mb-5 mt-2 flex w-fit" />
      {refused && (
        <InlineStatus tone="error" className="mb-5">
          {tx.connect.unrequested}
        </InlineStatus>
      )}
      {refused && wallet ? (
        <Button onClick={() => nav.pop()} className="mt-3 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {t.common.done}
        </Button>
      ) : (
        <ConnectPanel onConnected={setConnected} />
      )}
    </>
  )
}
