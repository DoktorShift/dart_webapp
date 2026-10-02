import { MESSAGES } from "@/lib/i18n"
import { SHARE_IMAGES } from "@/lib/metadata"
import { SITE, absoluteUrl } from "@/lib/site"

const t = MESSAGES.de

// What search engines and assistants read about the app and its maker (schema.org).
export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": absoluteUrl("/#app"),
      name: SITE.name,
      url: absoluteUrl("/"),
      description: t.meta.description,
      applicationCategory: "GameApplication",
      applicationSubCategory: "Darts",
      operatingSystem: "iOS, iPadOS, Android, Windows, macOS (Browser)",
      browserRequirements: "iOS 16 oder neuer, aktueller Chrome, Edge oder Firefox",
      inLanguage: ["de", "en"],
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      featureList: t.meta.features,
      image: absoluteUrl(SHARE_IMAGES[0].url),
      screenshot: absoluteUrl("/screenshots/phone-501.png"),
      author: { "@id": absoluteUrl("/#author") },
      publisher: { "@id": absoluteUrl("/#author") },
    },
    {
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      name: SITE.name,
      url: absoluteUrl("/"),
      inLanguage: ["de", "en"],
      publisher: { "@id": absoluteUrl("/#author") },
    },
    {
      "@type": "Person",
      "@id": absoluteUrl("/#author"),
      name: SITE.author.name,
      url: SITE.author.url,
      sameAs: [SITE.author.url],
      jobTitle: t.meta.jobTitle,
      description: t.meta.freelance(SITE.author.name),
    },
  ],
}

// As a script tag body: "<" escaped so no value can close the tag early.
export const structuredDataJson = () => JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c")
