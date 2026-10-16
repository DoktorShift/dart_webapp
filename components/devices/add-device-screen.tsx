"use client"

import { useEffect, useRef, useState } from "react"
import { Clock, Smartphone, UserRound } from "lucide-react"
import { CheckCode } from "@/components/common/check-code"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { Waiting } from "@/components/common/waiting"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PairColumns } from "@/components/devices/pair-columns"
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import type { AddDeviceControl, AddDevicePairing, HeldLink, PairingInput, PairingListener } from "@/lib/devices/pairing"
import { useSession } from "@/lib/profile/session"
import { runAction, type ScreenProps } from "@/lib/shell/registry"
import { parseAppLink } from "@/lib/shell/links"
import { SITE } from "@/lib/site"

// "Eigenes Gerät hinzufügen" (P2.03), on the device that has the profile: scan the new device's
// code (or paste its link, or type its code), compare the check code, and give the profile
// away with one clear tap. This is the only way a profile leaves a device: never the general
// scanner, never a board code (decision 0002 §7). A /#pair= link opened from outside lands here
// (params.payload) and is only held: it shows the check code it will have, and nothing is sent
// before the person taps "Verbinden" (research DR-08). A reload comes back to the pairing in
// progress (lib/devices/pairing.ts).
export default function AddDeviceScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(DEVICES_TEXTS)
  const s = tx.add
  const nav = useNav()
  const session = useSession()
  // null: the scanner (or the held link).
  const [view, setView] = useState<{ state: AddDevicePairing; offline: boolean } | null>(null)
  const [held, setHeld] = useState<HeldLink | "expired" | null>(null)
  const control = useRef<AddDeviceControl | null>(null)
  const payload = params.payload
  const signedIn = !!session
  const show: PairingListener<AddDevicePairing> = (state, offline) => setView({ state, offline })

  // A link from outside is held; without one, a pairing still in progress comes back.
  useEffect(() => {
    if (!signedIn) return
    let current = true
    void (async () => {
      const pairing = await import("@/lib/devices/pairing")
      if (!payload) {
        const made = await pairing.resumeAddDevice((state, offline) => current && setView({ state, offline }))
        if (current) control.current = made
        else made?.close()
        return
      }
      try {
        const { decodePairingLink } = await import("@/lib/protocol/pairing")
        const link = await pairing.holdLink(decodePairingLink(decodeURIComponent(payload)))
        if (current) setHeld(link)
      } catch {
        if (current) setHeld("expired")
      }
    })()
    return () => {
      current = false
    }
  }, [signedIn, payload])
  useEffect(() => () => control.current?.close(), [])

  const start = async (answer: () => Promise<AddDeviceControl>) => {
    control.current?.close()
    control.current = await answer()
  }

  // A scanned, pasted or typed code: only a pairing code is taken; everything else is answered
  // in place and scanning goes on.
  const onResult = async (text: string): Promise<ScanVerdict> => {
    const { decodePairingCode, decodePairingLink } = await import("@/lib/protocol/pairing")
    const link = parseAppLink(text, [window.location.origin, SITE.url])
    let input: PairingInput
    if (link) {
      if (link.kind !== "pair") return s.notPairing
      try {
        input = { link: decodePairingLink(decodeURIComponent(link.payload)) }
      } catch {
        return s.notPairing
      }
    } else {
      const code = decodePairingCode(text)
      if (!code) return /^[\w\s-]{10,20}$/.test(text.trim()) ? s.invalidCode : s.notPairing
      input = { code }
    }
    try {
      const { addDevice } = await import("@/lib/devices/pairing")
      await start(() => addDevice(input, show))
    } catch {
      return s.linkExpired
    }
  }

  const connect = (link: HeldLink) => {
    setHeld(null)
    void start(() => link.answer(show)).catch(() => setHeld("expired"))
  }

  // Back to the scanner: the new device hears that nothing comes.
  const startOver = () => {
    control.current?.decline()
    control.current?.close()
    control.current = null
    setView(null)
  }
  const again = { label: s.again, onClick: startOver }
  const cancel = (
    <Button variant="ghost" onClick={startOver} className="h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
      {t.common.cancel}
    </Button>
  )

  if (session === undefined) return null
  if (session === null) return <EmptyState icon={UserRound} title={s.noProfile} description={s.noProfileText} primary={{ label: s.createProfile, onClick: () => runAction("profile.create", nav) }} />
  if (held === "expired") return <EmptyState icon={Clock} title={s.expired} description={s.expiredText} primary={{ label: s.again, onClick: () => setHeld(null) }} />
  if (held)
    return (
      <PairColumns
        first={
          <>
            <h2 className="text-xl font-semibold leading-tight">{s.heldTitle}</h2>
            {/* In landscape the check code goes first, beside the buttons; the sentence follows. */}
            <p className="text-[1.0625rem] leading-snug text-muted-foreground xshort:order-last">{s.heldText}</p>
            <CheckCode code={held.checkCode} label={s.checkCode} />
          </>
        }
        second={
          <>
            <p className="text-[1.0625rem] font-semibold leading-snug">{s.warning}</p>
            <Button onClick={() => connect(held)} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
              {s.connect}
            </Button>
            <Button variant="secondary" onClick={() => setHeld(null)} className="h-12 w-full rounded-2xl text-[1.0625rem]">
              {t.common.cancel}
            </Button>
          </>
        }
      />
    )
  if (!view)
    return (
      <>
        <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{s.intro}</p>
        <QRScanner className="mt-6" onResult={onResult} manualLabel={s.manualLabel} manualPlaceholder={s.manualPlaceholder} inputMode="text" />
      </>
    )

  const { state, offline } = view
  const offlineStatus = offline && <InlineStatus tone="error">{tx.offline}</InlineStatus>
  switch (state.step) {
    case "looking":
      return (
        <div className="mt-2 grid gap-4">
          <Waiting className="py-6">{s.looking}</Waiting>
          <p className="text-center text-[0.9375rem] leading-snug text-muted-foreground">{s.lookingHint}</p>
          {offlineStatus || (state.unanswered && <InlineStatus>{s.notFound}</InlineStatus>)}
          {state.unanswered ? (
            <Button variant="secondary" onClick={startOver} className="h-12 w-full rounded-2xl text-[1.0625rem] text-primary">
              {s.retype}
            </Button>
          ) : (
            cancel
          )}
        </div>
      )
    case "found":
      return (
        <PairColumns
          first={
            <>
              <p className="text-[1.0625rem] font-semibold leading-snug">{s.warning}</p>
              <CheckCode code={state.checkCode} label={s.checkCode} />
            </>
          }
          second={
            <>
              <p className="text-[1.0625rem] leading-snug">{state.device ? s.compareDevice(state.device) : s.compare}</p>
              {offlineStatus}
              <Button onClick={() => control.current?.give()} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
                {s.give}
              </Button>
              <Button variant="secondary" onClick={startOver} className="h-12 w-full rounded-2xl text-[1.0625rem]">
                {s.decline}
              </Button>
            </>
          }
        />
      )
    case "confirmed":
      return (
        <PairColumns
          first={
            <>
              <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.confirmed}</p>
              <CheckCode code={state.checkCode} label={s.checkCode} />
            </>
          }
          second={
            <>
              <Waiting className="py-1">{s.waiting}</Waiting>
              {offlineStatus || (state.unanswered && <InlineStatus>{s.unanswered}</InlineStatus>)}
              {cancel}
            </>
          }
        />
      )
    case "sending":
      return (
        <div className="mt-2 grid gap-4">
          <Waiting>{s.sending}</Waiting>
          {offlineStatus}
        </div>
      )
    case "sent":
    case "done":
      return (
        <div className="mt-2 grid gap-4">
          <InlineStatus tone={state.step === "done" ? "success" : "info"}>{state.step === "done" ? s.done : s.sent}</InlineStatus>
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{state.step === "done" ? s.doneText : s.sentText}</p>
          <Button onClick={() => nav.pop()} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
            {s.finish}
          </Button>
        </div>
      )
    case "declined":
      return <EmptyState icon={Smartphone} title={s.declined} description={s.declinedText} primary={again} />
    case "expired":
      return <EmptyState icon={Clock} title={s.expired} description={s.expiredText} primary={again} />
    case "failed":
      if (state.reason === "too-long") return <EmptyState icon={Smartphone} title={s.tooLong} description={s.tooLongText} />
      if (state.reason === "not-taken") return <EmptyState icon={Smartphone} title={s.notTaken} description={s.notTakenText} primary={again} />
      return <EmptyState icon={Smartphone} title={s.wrongProfile} description={s.wrongProfileText} primary={again} />
  }
}
