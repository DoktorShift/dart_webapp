"use client"

import { Play } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import type { ResumeInfo } from "@/components/play-screen"

// The game that waits (left with "Speichern und verlassen"), above the tab bar on every tab but
// Spielen: one tap goes on with it, as Music keeps what is playing above its tabs (the iOS 26 tab
// bar accessory). The Play tab shows the same game as its first card and needs no strip. Not in
// a short landscape, where every point of height belongs to the content.
export function ResumeAccessory({ resume, onResume }: { resume: ResumeInfo; onResume: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onResume}
      className="mx-auto mb-2 flex h-12 w-full max-w-2xl items-center gap-3 rounded-2xl border border-border/70 bg-background/80 pl-2 pr-4 text-left shadow-[0_10px_30px_-14px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition-colors active:bg-secondary/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring xshort:hidden"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-semibold leading-tight">{t.play.resumeTitle(resume.title)}</span>
        <FitText className="text-[0.8125rem] leading-tight text-muted-foreground">{resume.detail}</FitText>
      </span>
      <span className="shrink-0 text-[0.9375rem] font-semibold text-primary">{t.common.continue}</span>
    </button>
  )
}
