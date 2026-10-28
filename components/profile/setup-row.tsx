"use client"

import { useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useT } from "@/components/i18n-provider"

// A row of game setup's player list that opens its own sheet ("Spieler per QR hinzufügen",
// "Runde speichern"), with "Abbrechen" at the sheet's end. Each opening starts fresh: the
// content is drawn with the opening's number to key it, and `close` to end it.
export function SetupSheetRow({
  icon: Icon,
  label,
  description,
  disabled = false,
  children,
}: {
  icon: LucideIcon
  label: string
  description: string
  disabled?: boolean
  children: (opening: number, close: () => void) => ReactNode
}) {
  const t = useT()
  const [sheet, setSheet] = useState({ open: false, opening: 0 })
  const close = () => setSheet((v) => ({ ...v, open: false }))
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setSheet((v) => ({ open: true, opening: v.opening + 1 }))}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.9375rem] font-medium text-primary transition-colors active:bg-secondary/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">{label}</span>
      </button>
      <Sheet open={sheet.open} onOpenChange={(open) => setSheet((v) => ({ ...v, open }))} title={label} description={description}>
        {sheet.opening > 0 && children(sheet.opening, close)}
        <Button variant="ghost" onClick={close} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </Sheet>
    </>
  )
}
