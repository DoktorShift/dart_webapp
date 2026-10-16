"use client"

import { AboutView } from "@/components/about-view"
import { useSiteQr } from "@/components/install-guide"

// "Über die App" inside the Profile tab: the About page without its own navigation bar. The
// install guide's QR code (for carrying on from a computer to a phone) is drawn on first use.
export default function AboutScreen() {
  return <AboutView qrSvg={useSiteQr(true)} embedded />
}
