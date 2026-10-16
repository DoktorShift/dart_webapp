"use client"

import { useEffect, useRef, useState } from "react"
import { Clock, Smartphone } from "lucide-react"
import { CheckCode } from "@/components/common/check-code"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { Waiting } from "@/components/common/waiting"
import { FitText } from "@/components/fit-text"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useAreaT, useT } from "@/components/i18n-provider"
import { ProfileArrived } from "@/components/devices/profile-arrived"
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import type { NewDeviceControl, NewDevicePairing } from "@/lib/devices/pairing"
import { buildLink } from "@/lib/shell/links"

// "Von meinem anderen Gerät" (P2.03), on the device that is to get the profile: a code to scan
// from the other device (and a link, and a code to type there), the check code to compare
// once that device answered, and the profile once both confirmed. A reload comes back to the
// same codes (lib/devices/pairing.ts). Every way it can end short says what happened and what
// to do next; "Neuen Code zeigen" starts over.
export default function NewDeviceScreen() {
  const t = useT()
  const s = useAreaT(DEVICES_TEXTS).newDevice
  const [state, setState] = useState<NewDevicePairing | null>(null)
  const [round, setRound] = useState(0)
  const control = useRef<NewDeviceControl | null>(null)

  useEffect(() => {
    let current = true
    setState(null)
    void import("@/lib/devices/pairing")
      .then(({ pairNewDevice }) => pairNewDevice((next) => current && setState(next)))
      .then(
        (made) => {
          if (current) control.current = made
          else made.close()
        },
        () => current && setState({ step: "failed", reason: "invalid" }),
      )
    return () => {
      current = false
      control.current?.close()
      control.current = null
    }
  }, [round])

  const again = { label: s.newCode, onClick: () => setRound((n) => n + 1) }
  const cancel = (
    <Button variant="ghost" onClick={() => control.current?.decline()} className="h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
      {t.common.cancel}
    </Button>
  )

  if (!state) return <Waiting>{t.shell.loading}</Waiting>
  switch (state.step) {
    case "waiting": {
      const link = buildLink(window.location.origin, "pair", state.link)
      return (
        <div className="mt-2 grid gap-5">
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.intro}</p>
          <QRCodeView value={link} label={s.qrLabel} share={{ url: link, title: t.profile.guest.fromDevice }} maxSize="45dvh" />
          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center">
            <p className="text-[0.9375rem] leading-snug text-muted-foreground">{s.orCode}</p>
            <FitText minScale={0.7} className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-wider">
              {state.code}
            </FitText>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">{s.codeValid(clock(t.intl, state.expires))}</p>
          </div>
        </div>
      )
    }
    case "found":
      return (
        <div className="mt-2 grid gap-4">
          <h2 className="text-xl font-semibold leading-tight">{s.foundTitle}</h2>
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{state.device ? s.found(state.device) : s.foundUnnamed}</p>
          <CheckCode code={state.checkCode} label={s.checkCode} />
          <p className="text-[1.0625rem] leading-snug">{s.compare}</p>
          <Button onClick={() => control.current?.confirm()} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
            {s.confirm}
          </Button>
          <Button variant="secondary" onClick={() => control.current?.decline()} className="h-12 w-full rounded-2xl text-[1.0625rem]">
            {s.decline}
          </Button>
        </div>
      )
    case "confirming":
      return (
        <div className="mt-2 grid gap-4">
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.confirming}</p>
          <CheckCode code={state.checkCode} label={s.checkCode} />
          <Waiting className="py-1">{s.waiting}</Waiting>
          {state.unanswered && <InlineStatus>{s.unanswered}</InlineStatus>}
          {cancel}
        </div>
      )
    case "receiving":
      return <Waiting>{s.receiving}</Waiting>
    case "done":
      return <ProfileArrived applied={state.applied} />
    case "declined":
      return <EmptyState icon={Smartphone} title={s.declined} description={s.declinedText} primary={again} />
    case "expired":
      return <EmptyState icon={Clock} title={s.expired} description={s.expiredText} primary={again} />
    case "failed":
      return state.reason === "occupied" ? <EmptyState icon={Smartphone} title={s.occupied} description={s.occupiedText} /> : <EmptyState icon={Smartphone} title={s.invalid} description={s.invalidText} primary={again} />
  }
}

const clock = (locale: string, seconds: number) => new Date(seconds * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
