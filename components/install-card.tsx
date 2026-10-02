"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, Download } from "lucide-react"
import { InstallGuide } from "@/components/install-guide"
import { useT } from "@/components/i18n-provider"
import { Sheet } from "@/components/ui/sheet"
import { useInstallApp } from "@/hooks/use-install-app"

// Whether this page already works without a connection: the service worker that keeps the app
// offline is running and in control. Updates live while it gets ready on a first visit.
function useOfflineReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const worker = navigator.serviceWorker
    if (!worker) return
    const check = () => setReady(worker.controller !== null)
    check()
    worker.addEventListener("controllerchange", check)
    return () => worker.removeEventListener("controllerchange", check)
  }, [])
  return ready
}

function Ready({ children }: { children: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.875rem] font-medium text-success">
      <CircleCheck className="h-4 w-4" aria-hidden="true" />
      {children}
    </span>
  )
}

// The About page's main action: install for offline play. Browsers that can install in one
// tap do so right here; the others open the step-by-step guide in a sheet. Once installed, the
// card says so and leads back to the scorer.
export function InstallCard({ qrSvg }: { qrSvg: string }) {
  const t = useT()
  const install = useInstallApp()
  const offlineReady = useOfflineReady()
  const [guideOpen, setGuideOpen] = useState(false)
  const installed = install?.kind === "installed"

  // Links to /about#install (from Settings) open the guide straight away.
  useEffect(() => {
    if (window.location.hash === "#install") setGuideOpen(true)
  }, [])

  const startInstall = () => (install?.kind === "prompt" ? install.install() : setGuideOpen(true))

  return (
    <section id="install" aria-label={t.install.title} className="mt-6 scroll-mt-16 rounded-3xl border border-primary/30 bg-card p-4 dark:bg-primary/10">
      {installed ? (
        <>
          <Ready>{t.install.installed}</Ready>
          <p className="mt-1.5 text-[1.0625rem] leading-snug">{t.about.installedNote}</p>
          <Link
            href="/"
            className="mt-4 flex h-14 items-center justify-center rounded-2xl bg-primary text-[1.0625rem] font-semibold text-primary-foreground active:bg-primary/80"
          >
            {t.about.openScorer}
          </Link>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={startInstall}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[1.0625rem] font-semibold text-primary-foreground active:bg-primary/80"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            {t.about.install}
          </button>
          <p className="mt-2 text-center text-[0.875rem] leading-snug text-muted-foreground">{t.about.installCaption}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {offlineReady && <Ready>{t.install.offlineReady}</Ready>}
            {install?.kind === "prompt" && (
              <button type="button" onClick={() => setGuideOpen(true)} className="min-h-11 text-[0.9375rem] font-medium text-primary">
                {t.about.howItWorks}
              </button>
            )}
          </div>
          <Link
            href="/"
            className="mt-2 flex h-12 items-center justify-center rounded-2xl text-[1.0625rem] font-medium text-primary active:bg-primary/10"
          >
            {t.about.openScorer}
          </Link>
        </>
      )}

      <Sheet open={guideOpen} onOpenChange={setGuideOpen} title={t.install.title} description={t.install.description}>
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
          <InstallGuide qrSvg={qrSvg} onDone={() => setGuideOpen(false)} />
        </div>
      </Sheet>
    </section>
  )
}
