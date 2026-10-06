"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRightLeft } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { CheckCode } from "@/components/live/board-sheets"
import { readPayload } from "@/components/live/link-payload"
import { useNav } from "@/components/nav/nav-context"
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
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { loadMatch } from "@/lib/game/storage"
import { takeHandoff, type HandoffTake, type HandoffTakeControl } from "@/lib/live/handoff"
import type { ScreenProps } from "@/lib/shell/registry"

// "Spiel übernehmen" (/#handoff=…), on the device that is to keep score from now on: take over,
// compare the check code with the other device, and go on with the game once it arrives. A game
// paused on this device would be replaced: that is asked first.
export default function TakeoverScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const s = tx.takeover
  const nav = useNav()
  const link = useMemo(() => readPayload("handoff", params.payload), [params.payload])
  const [take, setTake] = useState<HandoffTake>({ step: "ready" })
  const [replacing, setReplacing] = useState(false)
  const control = useRef<HandoffTakeControl | null>(null)
  const kept = useMemo(() => loadMatch(), [])

  useEffect(() => {
    if (!link) return
    const current = takeHandoff(link, setTake)
    control.current = current
    return () => {
      current.close()
      control.current = null
    }
  }, [link])

  useEffect(() => {
    if (take.step !== "done") return
    nav.pop()
    nav.resumeMatch(take.game)
  }, [take, nav])

  if (!link) return <EmptyState icon={ArrowRightLeft} title={s.notHandoff} />
  if (take.step === "asking")
    return (
      <div className="mt-2 grid gap-4">
        <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.asking}</p>
        <CheckCode code={take.checkCode} />
      </div>
    )
  if (take.step === "declined" || take.step === "failed")
    return <InlineStatus tone="error" className="mt-4">{take.step === "declined" ? s.declined : take.reason === "expired" ? s.expired : s.invalid}</InlineStatus>

  return (
    <div className="mt-2 grid gap-4">
      <p className="text-[1.0625rem] leading-snug text-muted-foreground">{s.description}</p>
      {kept && <InlineStatus>{s.replaces}</InlineStatus>}
      <Button onClick={() => (kept ? setReplacing(true) : control.current?.take())} disabled={take.step !== "ready"} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {s.take}
      </Button>
      <AlertDialog open={replacing} onOpenChange={setReplacing}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{s.replaceTitle}</AlertDialogTitle>
            <AlertDialogDescription>{s.replaceText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => control.current?.take()}>
              {s.replaceConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
