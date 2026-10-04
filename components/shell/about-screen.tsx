"use client"

import { useEffect, useState } from "react"
import { AboutView } from "@/components/about-view"
import { SITE } from "@/lib/site"

// "Über die App" inside the Profile tab: the About page without its own navigation bar. The
// install guide's QR code (for carrying on from a computer to a phone) is drawn on first use.
export default function AboutScreen() {
  const [qrSvg, setQrSvg] = useState("")
  useEffect(() => {
    let cancelled = false
    import("@/lib/qr").then(({ qrSvg: draw }) => {
      if (!cancelled) setQrSvg(draw(SITE.url))
    }, () => {
      // Offline before it was ever fetched: the guide works without its QR code.
    })
    return () => {
      cancelled = true
    }
  }, [])
  return <AboutView qrSvg={qrSvg} embedded />
}
