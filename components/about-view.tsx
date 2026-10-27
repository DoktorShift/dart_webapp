"use client"

import Image from "next/image"
import Link from "next/link"
import { ChevronLeft, ExternalLink, Gift, Users, WifiOff } from "lucide-react"
import { InstallCard } from "@/components/install-card"
import { useT } from "@/components/i18n-provider"
import { DisclosureRow, Group, LinkRow } from "@/components/ui/group"
import { SITE } from "@/lib/site"

const FACT_ICONS = [Gift, WifiOff, Users]

// The About page, kept short (HIG: progressive disclosure). One main action, installing for
// offline play; three quick facts; then rules, questions and the maker as rows that open in
// place. Rendered in the current language; the server's first render is German.
// `embedded`: shown inside the app's Profile tab, which brings its own navigation bar and scroll
// area.
export function AboutView({ qrSvg, embedded = false }: { qrSvg: string; embedded?: boolean }) {
  const t = useT()
  const games = [
    t.about.x01,
    ...(["cricket", "cutthroat", "clock"] as const).map((id) => ({ name: t.modes[id].name, rules: t.modes[id].rules({ bullFinish: false }) })),
  ]

  // Inside the app the navigation bar holds the page's title, so the name is a subheading.
  const Heading = embedded ? "h2" : "h1"
  const content = (
    <>
      <div className="flex flex-col items-center text-center">
        <Image src="/icon/192" alt="" width={88} height={88} priority className="h-22 w-22 rounded-[1.4rem] shadow-lg" />
        <Heading className="mt-4 font-display text-5xl font-semibold leading-none tracking-tight">{SITE.name}</Heading>
        <p className="mt-2 text-[1.0625rem] text-muted-foreground">{t.meta.tagline}</p>
      </div>

      <InstallCard qrSvg={qrSvg} inApp={embedded} />

      <ul className="mt-6 grid grid-cols-3 gap-2 text-center">
        {t.about.facts.map((fact, i) => {
          const Icon = FACT_ICONS[i] ?? Gift
          return (
            <li key={fact} className="flex flex-col items-center gap-1.5 rounded-2xl bg-secondary/50 px-2 py-3 text-[0.8125rem] font-medium leading-tight">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              {fact}
            </li>
          )
        })}
      </ul>

      <Group title={t.about.howToPlay}>
        {games.map((game) => (
          <DisclosureRow key={game.name} title={game.name}>
            {game.rules}
          </DisclosureRow>
        ))}
      </Group>

      <Group title={t.about.questions}>
        {t.about.faq.map((item) => (
          <DisclosureRow key={item.q} title={item.q}>
            {item.a}
          </DisclosureRow>
        ))}
      </Group>

      <Group title={t.about.madeBy(SITE.author.name)}>
        <div className="space-y-2 px-4 py-3.5 text-[1.0625rem] leading-relaxed">
          {t.about.authorNote.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <LinkRow href={SITE.author.url} external>
          <span className="font-medium text-primary">{t.about.contact(SITE.author.name)}</span>
        </LinkRow>
      </Group>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 px-1 text-[0.8125rem] text-muted-foreground">
        <span>
          © {new Date().getFullYear()} {SITE.author.name}
        </span>
        <a href={SITE.source} rel="noopener" target="_blank" className="flex min-h-11 items-center gap-1 text-primary">
          {t.about.source}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </footer>
    </>
  )

  if (embedded) return <div className="select-text pt-4">{content}</div>

  return (
    <div className="h-full select-text overflow-y-auto overscroll-contain bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="relative mx-auto flex h-11 max-w-xl items-center px-2">
          <Link
            href="/"
            className="relative z-10 flex min-h-11 items-center gap-0.5 rounded-lg pr-3 text-[1.0625rem] text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
            {t.about.back}
          </Link>
          <span className="pointer-events-none absolute inset-x-0 text-center text-[1.0625rem] font-semibold">{t.about.title}</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-16 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-8">
        {content}
      </main>
    </div>
  )
}
