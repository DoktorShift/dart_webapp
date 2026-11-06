"use client"

import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Group, LinkRow } from "@/components/ui/group"
import { PRIVACY } from "@/lib/privacy"
import { SITE } from "@/lib/site"

// The privacy policy (lib/privacy.ts) in the current language: the /privacy page, or, `embedded`,
// a screen of About inside the app, whose navigation bar brings the title and back button.
export function PrivacyView({ embedded = false }: { embedded?: boolean }) {
  const { locale, t } = useI18n()
  const p = PRIVACY[locale === "de" ? "de" : "en"]

  const content = (
    <>
      {!embedded && <h1 className="font-display text-4xl font-semibold leading-none tracking-tight">{p.title}</h1>}
      <p className="mt-3 text-[0.8125rem] text-muted-foreground">{p.updated}</p>
      <p className="mt-4 text-[1.0625rem] leading-relaxed">{p.intro}</p>
      {p.sections.map((section) => (
        <section key={section.heading} className="mt-7">
          <h2 className="text-[1.25rem] font-semibold">{section.heading}</h2>
          {section.paragraphs.map((text) => (
            <p key={text} className="mt-2 text-[1.0625rem] leading-relaxed text-foreground/90">
              {text}
            </p>
          ))}
        </section>
      ))}
      <Group>
        <LinkRow href={SITE.author.url} external>
          <span className="font-medium text-primary">{p.contact}</span>
        </LinkRow>
      </Group>
    </>
  )

  if (embedded) return <div className="select-text pb-10 pt-2">{content}</div>

  return (
    <div className="h-full select-text overflow-y-auto overscroll-contain bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="relative mx-auto flex h-11 max-w-xl items-center px-2">
          <Link
            href="/about"
            className="relative z-10 flex min-h-11 items-center gap-0.5 rounded-lg pr-3 text-[1.0625rem] text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
            {t.nav.about}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-8">{content}</main>
    </div>
  )
}
