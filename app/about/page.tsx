import type { Metadata } from "next"
import { AboutView } from "@/components/about-view"
import { MESSAGES } from "@/lib/i18n"
import { pageMetadata } from "@/lib/metadata"
import { qrSvg } from "@/lib/qr"
import { SITE } from "@/lib/site"

const t = MESSAGES.de

export const metadata: Metadata = {
  ...pageMetadata({ title: t.about.metaTitle, description: t.about.metaDescription, path: "/about" }),
  title: t.about.metaTitle,
}

// The QR code for the install guide is drawn here, at build time, so the page ships no QR code
// library: it encodes the site's own address.
export default function AboutPage() {
  return <AboutView qrSvg={qrSvg(SITE.url)} />
}
