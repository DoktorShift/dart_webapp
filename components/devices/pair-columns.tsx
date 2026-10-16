import type { ReactNode } from "react"
import { CheckCode } from "@/components/common/check-code"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/common/waiting"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"

// A pairing step on a phone in landscape (xshort), on both sides (./new-device-screen.tsx,
// ./add-device-screen.tsx): what to compare on the left, what to do on the right, so the code
// and the buttons are both in view without scrolling. One column everywhere else.
export function PairColumns({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <div className="mt-2 grid gap-4 xshort:grid-cols-2 xshort:items-start xshort:gap-x-6">
      <div className="grid gap-4">{first}</div>
      <div className="grid gap-4">{second}</div>
    </div>
  )
}

// The quiet way out of a pairing step.
export function PairCancel({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" onClick={onClick} className="h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
      {t.common.cancel}
    </Button>
  )
}

// Either side, once its own answer is given: the check code stays in view while the other
// device confirms. `offline` (a status) goes before "no answer yet".
export function CheckWaiting({
  text,
  code,
  texts,
  offline,
  unanswered,
  onCancel,
}: {
  text: string
  code: string
  texts: { checkCode: string; waiting: string; unanswered: string }
  offline: ReactNode
  unanswered: boolean
  onCancel: () => void
}) {
  return (
    <PairColumns
      first={
        <>
          <p className="text-[1.0625rem] leading-snug text-muted-foreground">{text}</p>
          <CheckCode code={code} label={texts.checkCode} />
        </>
      }
      second={
        <>
          <Waiting className="py-1">{texts.waiting}</Waiting>
          {offline || (unanswered && <InlineStatus>{texts.unanswered}</InlineStatus>)}
          <PairCancel onClick={onCancel} />
        </>
      }
    />
  )
}
