import type { ReactNode } from "react"

// A titled stack of cards on a tab's root (clubs, tournaments): the title in footnote style
// like a group's, the cards below it with room between them.
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-6">
      <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}
