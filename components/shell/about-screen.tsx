"use client"

import { AboutView } from "@/components/about-view"
import { useSiteQr } from "@/components/install-guide"
import { useNav } from "@/components/nav/nav-context"
import { SCREENS } from "@/lib/shell/registry"

// "Über die App" inside the Profile tab: the About page without its own navigation bar. The
// install guide's QR code (for carrying on from a computer to a phone) is drawn on first use.
export default function AboutScreen() {
  const nav = useNav()
  return <AboutView qrSvg={useSiteQr(true)} embedded onOpenPrivacy={() => nav.push(SCREENS.privacy)} />
}
