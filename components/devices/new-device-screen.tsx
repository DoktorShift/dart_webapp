"use client"

import { useEffect, useRef, useState } from "react"
import { Clock, Smartphone } from "lucide-react"
import { CheckCode } from "@/components/common/check-code"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { ShareActions } from "@/components/common/share-actions"
import { Waiting } from "@/components/common/waiting"
import { FitText } from "@/components/fit-text"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CheckWaiting, PairColumns } from "@/components/devices/pair-columns"
import { ProfileArrived } from "@/components/devices/profile-arrived"
import { formatClock } from "@/lib/i18n"
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import type { NewDeviceControl, NewDevicePairing } from "@/lib/devices/pairing"
import { buildLink } from "@/lib/shell/links"

// "Von meinem anderen Gerät" (P2.03), on the device that is to get the profile: a code to scan
// from the other device (and a code to type there, and a link to send), the check code to
// compare once that device answered, and the profile once both confirmed. A reload comes back
// to the same codes (lib/devices/pairing.ts). Every way it can end short says what happened and
// what to do next; "Neuen Code zeigen" starts over. While nothing reaches the internet, it says
// so and keeps trying.
export default function NewDeviceScreen() {
  const t = useT()
  const tx = useAreaT(DEVICES_TEXTS)
  const s = tx.newDevice
  const [view, setView] = useState<{ state: NewDevicePairing; offline: boolean } | null>(null)
  const [round, setRound] = useState(0)
  const control = useRef<NewDeviceControl | null>(null)

  useEffect(() => {
    let current = true
    setView(null)
    void import("@/lib/devices/pairing")
      .then(({ pairNewDevice }) => pairNewDevice((state, offline) => current && setView({ state, offline })))
      .then(
        (made) => {
          if (current) control.current = made
          else made.close()
        },
        () => current && setView({ state: { step: "failed", reason: "invalid" }, offline: false }),
      )
    return () => {
      current = false
      control.current?.close()
      control.current = null
    }
  }, [round])

  const again = { label: s.newCode, onClick: () => setRound((n) => n + 1) }
  if (!view) return <Waiting>{t.shell.loading}</Waiting>
  const { state, offline } = view
  const offlineStatus = offline && <InlineStatus tone="error">{tx.offline}</InlineStatus>

  switch (state.step) {
    case "waiting": {
      const link = buildLink(window.location.origin, "pair", state.link)
      // Scanning the code, or typing it, is the way; sending the link is the rare one. On a phone
      // in landscape the code stands beside the rest.
      return (
        <div className="mt-2 grid gap-5 xshort:grid-cols-2 xshort:items-start xshort:gap-x-6">
          <p className="text-[1.0625rem] leading-snug text-muted-foreground xshort:col-start-2 xshort:row-start-1">{s.intro}</p>
          <QRCodeView value={link} label={s.qrLabel} maxSize="max(9rem, min(45dvh, 100dvh - 24rem))" className="xshort:col-start-1 xshort:row-span-4 xshort:row-start-1" />
          {offline && <div className="xshort:col-start-2">{offlineStatus}</div>}
          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center xshort:col-start-2">
            <p className="text-[0.9375rem] leading-snug text-muted-foreground">{s.orCode}</p>
            <FitText minScale={0.7} className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-wider">
              {state.code}
            </FitText>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">{s.codeValid(formatClock(t, state.expires * 1000))}</p>
          </div>
          <ShareActions url={link} title={t.profile.guest.fromDevice} quiet className="xshort:col-start-2" />
        </div>
      )
    }
    case "found":
      return (
        <PairColumns
          first={
            <>
              <h2 className="text-xl font-semibold leading-tight">{s.foundTitle}</h2>
              <p className="text-[1.0625rem] leading-snug text-muted-foreground">{state.device ? s.found(state.device) : s.foundUnnamed}</p>
              <CheckCode code={state.checkCode} label={s.checkCode} />
            </>
          }
          second={
            <>
              <p className="text-[1.0625rem] leading-snug">{s.compare}</p>
              <Button onClick={() => control.current?.confirm()} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
                {s.confirm}
              </Button>
              <Button variant="secondary" onClick={() => control.current?.decline()} className="h-12 w-full rounded-2xl text-[1.0625rem]">
                {s.decline}
              </Button>
            </>
          }
        />
      )
    case "confirming":
      return <CheckWaiting text={s.confirming} code={state.checkCode} texts={s} offline={offlineStatus} unanswered={state.unanswered} onCancel={() => control.current?.decline()} />
    case "receiving":
      return <Waiting>{s.receiving}</Waiting>
    case "done":
      return <ProfileArrived applied={state.applied} />
    case "declined":
      return <EmptyState icon={Smartphone} title={s.declined} description={s.declinedText} primary={again} />
    case "expired":
      return <EmptyState icon={Clock} title={s.expired} description={s.expiredText} primary={again} />
    case "failed":
      if (state.reason === "occupied") return <EmptyState icon={Smartphone} title={s.occupied} description={s.occupiedText} />
      if (state.reason === "other-device") return <EmptyState icon={Smartphone} title={s.otherDevice} description={s.otherDeviceText} primary={again} />
      return <EmptyState icon={Smartphone} title={s.invalid} description={s.invalidText} primary={again} />
  }
}
