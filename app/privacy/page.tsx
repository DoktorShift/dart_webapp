import type { Metadata } from "next"
import { PrivacyView } from "@/components/privacy-view"
import { pageMetadata } from "@/lib/metadata"
import { PRIVACY } from "@/lib/privacy"

const p = PRIVACY.de

export const metadata: Metadata = {
  ...pageMetadata({ title: p.title, description: p.intro, path: "/privacy" }),
  title: p.title,
}

// The privacy policy as its own page: the address App Store Connect and the stores link to.
// Inside the app it is a screen of About (components/shell/privacy-screen.tsx).
export default function PrivacyPage() {
  return <PrivacyView />
}
