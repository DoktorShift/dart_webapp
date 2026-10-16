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
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import type { AddDeviceControl, AddDevicePairing, PairingInput } from "@/lib/devices/pairing"
import { useSession } from "@/lib/profile/session"
import type { ScreenProps } from "@/lib/shell/registry"
import { parseAppLink } from "@/lib/shell/links"
import { SITE } from "@/lib/site"

// "Eigenes Gerät hinzufügen" (P2.03), on the device that has the profile: scan the new device's
// code (or paste its link, or type its code), compare the check code, and give the profile
// away with one clear tap. This is the only way a profile leaves a device: never the general
// scanner, never a board code (decision 0002 §7). A /#pair= link opened on this device lands
// here with the code already in (params.payload). A reload comes back to the pairing in
// progress (lib/devices/pairing.ts).
export default function AddDeviceScreen({ params }: ScreenProps) {
  const t = useT()
  const s = useAreaT(DEVICES_TEXTS).add
  const nav = useNav()
  const session = useSession()
  // null: the scanner.
  const [state, setState] = useState<AddDevicePairing | null>(null)
  const [round, setRound] = useState(0)
  const control = useRef<AddDeviceControl | null>(null)
  const payload = params.payload
  const signedIn = !!session

  // The link the screen was opened with (once), else a pairing still in progress.
  useEffect(() => {
    if (!signedIn) return
    let current = true
    const onChange = (next: AddDevicePairing) => current && setState(next)
    void (async () => {
      const { addDevice, resumeAddDevice } = await import("@/lib/devices/pairing")
      let made: AddDeviceControl | null = null
      if (payload && round === 0) {
        try {
          const { decodePairingLink } = await import("@/lib/protocol/pairing")
          made = await addDevice({ link: decodePairingLink(decodeURIComponent(payload)) }, onChange)
        } catch {
          if (current) setState({ step: "expired" })
        }
      } else made = await resumeAddDevice(onChange)
      if (!current) made?.close()
      else control.current = made
    })()
    return () => {
      current = false
      control.current?.close()
      control.current = null
    }
  }, [signedIn, payload, round])

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
      control.current = await addDevice(input, setState)
    } catch {
      return s.linkExpired
    }
  }

  // Back to the scanner: the new device hears that nothing comes.
  const startOver = () => {
    control.current?.decline()
    setRound((n) => n + 1)
    setState(null)
  }
  const again = { label: s.again, onClick: startOver }
  const cancel = (
    <Button variant="ghost" onClick={startOver} className="h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
      {t.common.cancel}
    </Button>
  )

  if (session === undefined) return null
  if (session === null) return <EmptyState icon={UserRound} title={s.noProfile} description={s.noProfileText} />
  if (!state)
    return (
      <>
        <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{s.intro}</p>
        <QRScanner className="mt-6" onResult={onResult} manualLabel={s.manualLabel} manualPlaceholder={s.manualPlaceholder} inputMode="text" />
      </>
    )
  switch (state.step) {
    case "looking":
      return (
        <div className="mt-2 grid gap-4">
          <Waiting className="py-6">{s.looking}</Waiting>
          <p className="text-center text-[0.9375rem] leading-snug text-muted-foreground">{s.lookingHint}</p>
          {cancel}
        </div>
      )
    case "found":
      return (
        <div className="mt-2 grid gap-4">
          <p className="text-[1.0625rem] font-semibold leading-snug">{s.warning}</p>
          <CheckCode code={state.checkCode} label={s.checkCode} />
          <p className="text-[1.0625rem] leading-snug">{state.device ? s.compareDevice(state.device) : s.compare}</p>
          <Button onClick={() => control.current?.give()} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
            {s.give}
          </Button>
          <Button variant="secondary" onClick={startOver} className="h-12 w-full rounded-2xl text-[1.0625rem]">
            {s.decline}
          </Button>
        </div>
      )
    case "confirmed":
      return (
        <div className="mt-2 grid gap-4">
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.confirmed}</p>
          <CheckCode code={state.checkCode} label={s.checkCode} />
          <Waiting className="py-1">{s.waiting}</Waiting>
          {state.unanswered && <InlineStatus>{s.unanswered}</InlineStatus>}
          {cancel}
        </div>
      )
    case "sending":
      return <Waiting>{s.sending}</Waiting>
    case "done":
      return (
        <div className="mt-2 grid gap-4">
          <InlineStatus tone="success">{s.done}</InlineStatus>
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.doneText}</p>
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
      return state.reason === "too-long" ? <EmptyState icon={Smartphone} title={s.tooLong} description={s.tooLongText} /> : <EmptyState icon={Smartphone} title={s.wrongProfile} description={s.wrongProfileText} primary={again} />
  }
}
