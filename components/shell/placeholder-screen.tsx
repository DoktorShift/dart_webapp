"use client"

import { Hourglass } from "lucide-react"
import { useT } from "@/components/i18n-provider"
import type { ScreenProps } from "@/lib/shell/registry"

// What a screen shows until its area replaces it: the right title (from the registry) and one
// honest sentence. A link that arrived here says that this version can't open it yet.
export function PlaceholderScreen({ params }: ScreenProps) {
  const t = useT()
  return (
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4">
      <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-[1.0625rem] leading-snug text-muted-foreground">{params.payload !== undefined ? t.shell.linkNotYet : t.shell.comingSoon}</p>
    </div>
  )
}
