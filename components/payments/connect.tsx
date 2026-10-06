"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Smartphone } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { Button } from "@/components/ui/button"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { OutcomeHeader } from "@/components/payments/entry-status"
import { problemText } from "@/components/payments/problem"
import { PaymentSignet } from "@/components/payments/signet"
import { capabilityText, WalletRights } from "@/components/payments/wallet-details"
import { forgetReturnedConnection, returnedConnection, walletAppLink } from "@/components/payments/wallet-return"
import { scanKind } from "@/lib/payments/invoices"
import { connectNewWallet, type WalletInfo } from "@/lib/payments/wallet"
import type { ScreenProps } from "@/lib/shell/registry"

// "Wallet verbinden" (PLAN.md: "Wallet verbinden" → QR scannen oder Verbindung einfügen →
// Rechte prüfen → "Verbunden"). The scanner takes only a wallet connection and names an invoice
// for what it is. On a phone, a wallet app on the same device can create the connection and come
// back (./wallet-return.ts). Used as a screen in Zahlungen and inside the payment sheets (there
// `titled`, under the sheet's own title), so a payment that needed a wallet carries on right after.
export function ConnectPanel({
  onConnected,
  onCancel,
  titled = false,
  returned = null,
}: {
  onConnected: (info: WalletInfo) => void
  onCancel?: () => void
  titled?: boolean
  returned?: string | null
}) {
  const t = useT()
  const c = t.payments.connect
  const [connecting, setConnecting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [appLink, setAppLink] = useState<string | null>(null)
  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  })

  // Only phones and tablets have wallet apps to open; known only in the browser.
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) setAppLink(walletAppLink(window.location.origin))
  }, [])

  // A message when it didn't work, nothing when connected.
  const connect = useCallback(
    async (uri: string): Promise<string | undefined> => {
      setConnecting(true)
      setProblem(null)
      try {
        onConnectedRef.current(await connectNewWallet(uri))
      } catch (error) {
        return problemText(t, error)
      } finally {
        setConnecting(false)
      }
    },
    [t],
  )

  useEffect(() => {
    if (!returned) return
    void connect(returned).then((message) => {
      forgetReturnedConnection()
      if (message) setProblem(message)
    })
  }, [returned, connect])

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
          <h3 className="text-[1.0625rem] font-semibold leading-snug">{c.title}</h3>
        </div>
      )}
      <p className="text-[1.0625rem] leading-snug text-muted-foreground">{c.intro}</p>
      <QRScanner className="mt-5" onResult={onResult} manualLabel={c.manualLabel} manualPlaceholder={c.manualPlaceholder} />
      {connecting && <InlineStatus className="mt-3">{c.connecting}</InlineStatus>}
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
      {appLink && (
        <div className="mt-6">
          <Button asChild variant="secondary" className="h-12 w-full gap-2 whitespace-normal rounded-xl text-[1.0625rem] font-semibold text-primary">
            <a href={appLink}>
              <Smartphone className="h-5 w-5 shrink-0" aria-hidden="true" />
              {c.openApp}
            </a>
          </Button>
          <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{c.openAppHint}</p>
        </div>
      )}
      <p className="mt-6 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{c.namesDiffer}</p>
      <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{t.payments.wallet.privacy}</p>
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
  const t = useT()
  return (
    <>
      <OutcomeHeader tone="success" title={t.payments.connect.connected} text={`${info.alias ?? t.payments.yourWallet} · ${capabilityText(t, info)}`} />
      <WalletRights info={info} figures />
    </>
  )
}

// Zahlungen › Wallet verbinden. A connection a wallet app sent back is taken right away.
export default function ConnectScreen({ params }: ScreenProps) {
  const t = useT()
  const nav = useNav()
  const [returned] = useState(() => (params.returned ? returnedConnection() : null))
  const [connected, setConnected] = useState<WalletInfo | null>(null)

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
  return (
    <>
      <PaymentSignet size="large" className="mx-auto mb-5 mt-2 flex w-fit" />
      <ConnectPanel onConnected={setConnected} returned={returned} />
    </>
  )
}
