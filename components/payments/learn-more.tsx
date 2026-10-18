"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DisclosureRow } from "@/components/ui/group"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"

// "Mehr erfahren" about payments (nostrdesign.org, zaps): where the money goes, that BlueLine
// never holds any, what sats are, what a public congratulation shows, and what happens when a
// payment isn't confirmed. On a screen it opens a sheet; inside a payment sheet it opens in place,
// so no sheet is stacked on another.

function PaymentFacts() {
  const tx = useAreaT(PAYMENTS_TEXTS)
  return (
    <dl className="flex flex-col gap-3">
      {tx.learn.facts.map(({ title, text }) => (
        <div key={title}>
          <dt className="text-[1.0625rem] font-semibold leading-snug text-foreground">{title}</dt>
          <dd className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  )
}

export function LearnMore({ inline = false }: { inline?: boolean }) {
  const t = useT()
  const learn = useAreaT(PAYMENTS_TEXTS).learn
  const [open, setOpen] = useState(false)
  if (inline) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <DisclosureRow title={learn.button}>
          <PaymentFacts />
        </DisclosureRow>
      </div>
    )
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="h-11 rounded-xl px-3 text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
        {learn.button}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={learn.title}>
        <SheetBody>
          <PaymentFacts />
        </SheetBody>
        <Button onClick={() => setOpen(false)} className="mt-4 h-12 w-full shrink-0 rounded-xl text-[1.0625rem] font-semibold">
          {t.common.done}
        </Button>
      </Sheet>
    </>
  )
}
