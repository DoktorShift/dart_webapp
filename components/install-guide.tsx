"use client"

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { InstallPictureFrame } from "@/components/install-pictures"
import { useT } from "@/components/i18n-provider"
import { INSTALL_PICTURES, INSTALL_PLATFORMS, detectPlatform, type InstallPlatform } from "@/lib/install"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

// Step-by-step help for putting BlueLine on a phone, tablet or computer: this device is picked
// for you, each step has a picture, and a computer gets a QR code to carry on with a phone.
export function InstallGuide({ qrSvg, onDone }: { qrSvg: string; onDone: () => void }) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [platform, setPlatform] = useState<InstallPlatform>("ios")
  const [detected, setDetected] = useState<InstallPlatform | null>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const device = detectPlatform()
    setDetected(device)
    setPlatform(device)
  }, [])

  const steps = t.install.steps[platform]
  const pictures = INSTALL_PICTURES[platform]
  const last = step === steps.length - 1

  const choose = (next: InstallPlatform) => {
    setPlatform(next)
    setStep(0)
  }

  return (
    <div className="space-y-3">
      {/* This device is chosen for you; the others are one tap away. */}
      <div role="radiogroup" aria-label={t.install.device} className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/70 p-1">
        {INSTALL_PLATFORMS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={platform === id}
            onClick={() => choose(id)}
            className={cn(
              "min-h-11 rounded-lg px-1 text-[0.9375rem] font-medium leading-tight transition-colors",
              platform === id ? "bg-background text-foreground shadow" : "text-muted-foreground",
            )}
          >
            {t.install.platforms[id]}
            {detected === id && <span className="block text-[0.6875rem] font-normal text-muted-foreground">{t.install.thisDevice}</span>}
          </button>
        ))}
      </div>

      <section aria-roledescription="step-by-step guide" aria-label={t.install.guideFor(t.install.platforms[platform])}>
        {/* The next step slides in over the last one; the sheet keeps its size. */}
        <motion.div
          key={`${platform}-${step}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.3, 1] }}
        >
          <InstallPictureFrame picture={pictures[step]} />
          <div className="px-1 pt-3" aria-live="polite">
            <p className="text-[0.8125rem] font-medium text-primary">{t.install.step(step + 1, steps.length)}</p>
            <h3 className="mt-0.5 text-[1.0625rem] font-semibold">{steps[step].title}</h3>
            <p className="mt-0.5 min-h-[4.2rem] text-[0.9375rem] leading-snug text-muted-foreground">{steps[step].text}</p>
          </div>
        </motion.div>

        <div className="sticky bottom-0 z-[1] mt-1 flex items-center gap-2 bg-background py-1">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex h-11 items-center gap-1 rounded-xl px-3 text-[1.0625rem] text-primary active:bg-secondary disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            {t.common.back}
          </button>
          <span className="flex flex-1 justify-center gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40")} />
            ))}
          </span>
          <button
            type="button"
            onClick={() => (last ? onDone() : setStep(step + 1))}
            className="flex h-11 items-center gap-1 rounded-xl bg-primary px-4 text-[1.0625rem] font-semibold text-primary-foreground active:bg-primary/80"
          >
            {last ? t.common.done : t.common.next}
            {last ? <Check className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </section>

      {/* From a computer to the phone at the board. */}
      {platform === "desktop" && (
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-3">
          <div
            className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white p-1"
            role="img"
            aria-label={t.install.qrLabel}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div>
            <p className="text-[1.0625rem] font-semibold">{t.install.qrTitle}</p>
            <p className="mt-0.5 text-[0.875rem] leading-snug text-muted-foreground">{t.install.qrText(SITE.shortName)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
