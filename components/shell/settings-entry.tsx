"use client"

import { useState } from "react"
import { InstallGuideSheet, useSiteQr } from "@/components/install-guide"
import { SettingsScreen } from "@/components/settings-screen"
import { useAppSettings } from "@/components/shell/app-settings"

// Settings as a screen of the Profile tab. The install guide opens right here in a sheet (it used
// to be a link to /about#install, which left the app); its QR code for carrying on from a
// computer to a phone is drawn when the guide is first opened.
export default function SettingsEntry() {
  const { settings, onSettingsChange } = useAppSettings()
  const [guideOpen, setGuideOpen] = useState(false)
  const qrSvg = useSiteQr(guideOpen)

  return (
    <>
      <SettingsScreen settings={settings} onSettingsChange={onSettingsChange} onOpenGuide={() => setGuideOpen(true)} />
      <InstallGuideSheet open={guideOpen} onOpenChange={setGuideOpen} qrSvg={qrSvg} />
    </>
  )
}
