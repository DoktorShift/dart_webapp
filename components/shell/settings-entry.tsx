"use client"

import { useEffect, useState } from "react"
import { InstallGuide } from "@/components/install-guide"
import { SettingsScreen } from "@/components/settings-screen"
import { Sheet } from "@/components/ui/sheet"
import { useAppSettings } from "@/components/shell/app-settings"
import { useT } from "@/components/i18n-provider"
import { SITE } from "@/lib/site"

// Settings as a screen of the Profile tab. The install guide opens right here in a sheet (it used
// to be a link to /about#install, which left the app); its QR code for carrying on from a
// computer to a phone is drawn when the guide is first opened.
export default function SettingsEntry() {
  const t = useT()
  const { settings, onSettingsChange } = useAppSettings()
  const [guideOpen, setGuideOpen] = useState(false)
  const [qrSvg, setQrSvg] = useState("")

  useEffect(() => {
    if (!guideOpen || qrSvg) return
    let cancelled = false
    import("@/lib/qr").then(({ qrSvg: draw }) => {
      if (!cancelled) setQrSvg(draw(SITE.url))
    }, () => {
      // Offline before it was ever fetched: the guide works without its QR code.
    })
    return () => {
      cancelled = true
    }
  }, [guideOpen, qrSvg])

  return (
    <>
      <SettingsScreen settings={settings} onSettingsChange={onSettingsChange} onOpenGuide={() => setGuideOpen(true)} />
      <Sheet open={guideOpen} onOpenChange={setGuideOpen} title={t.install.title} description={t.install.description}>
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
          <InstallGuide qrSvg={qrSvg} onDone={() => setGuideOpen(false)} />
        </div>
      </Sheet>
    </>
  )
}
