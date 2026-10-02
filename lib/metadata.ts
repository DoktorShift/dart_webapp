import type { Metadata } from "next"
import { MESSAGES } from "@/lib/i18n"
import { SITE } from "@/lib/site"

// Pages are rendered in German, the standard language, so that is what link previews and
// search engines see. The same share pictures are used for every page.
const t = MESSAGES.de

export const SHARE_IMAGES = [
  { url: "/social/blueline-darts-1200x630-de.jpg", width: 1200, height: 630, alt: t.meta.imageAlt },
  // Square, for small previews (WhatsApp, iMessage, Reddit thumbnails).
  { url: "/social/blueline-darts-1200x1200-de.jpg", width: 1200, height: 1200, alt: t.meta.imageAlt },
]

// Title, description, canonical address and share cards for one page.
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE.name,
      locale: "de_DE",
      alternateLocale: ["en_GB"],
      title,
      description,
      images: SHARE_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGES[0]] },
  }
}
