import type { Metadata, Viewport } from "next"
import { Barlow_Condensed, Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/components/i18n-provider"
import { ServiceWorker } from "@/components/service-worker"
import { SPLASH_IMAGES } from "@/lib/apple-splash"
import { MESSAGES } from "@/lib/i18n"
import { pageMetadata } from "@/lib/metadata"
import { SITE } from "@/lib/site"
import { structuredDataJson } from "@/lib/structured-data"
import type React from "react"

const inter = Inter({ subsets: ["latin"] })
// Scoreboard-style numerals and headings, like the number ring on a board.
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" })

// German is the standard language: the page, its metadata and its share cards start in German.
const t = MESSAGES.de

export const metadata: Metadata = {
  ...pageMetadata({ title: t.meta.title, description: t.meta.description, path: "/" }),
  metadataBase: new URL(SITE.url),
  title: { default: t.meta.title, template: `%s | ${SITE.name}` },
  applicationName: SITE.name,
  keywords: t.meta.keywords,
  authors: [{ name: SITE.author.name, url: SITE.author.url }],
  creator: SITE.author.name,
  publisher: SITE.author.name,
  category: "games",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  appleWebApp: {
    capable: true,
    title: SITE.shortName,
    statusBarStyle: "black-translucent",
    startupImage: SPLASH_IMAGES.map(({ id, media }) => ({ url: `/apple-splash/${id}`, media })),
  },
  // Scores like 501 must never turn into phone-number links on iOS.
  formatDetection: { telephone: false },
}

// viewport-fit=cover makes env(safe-area-inset-*) work on notched iPhones and iPads.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#020817" },
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang={t.lang} suppressHydrationWarning>
      <body className={`${inter.className} ${display.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
        <ServiceWorker />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredDataJson() }} />
      </body>
    </html>
  )
}
