import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { Segmented, type SegmentedOption } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// An inset grouped list, like iOS Settings: a small title, rows in a rounded card, a footer.
export function Group({ title, footer, className, children }: { title?: string; footer?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("mt-8 first:mt-6", className)}>
      {title && <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
      {footer && <p className="mt-2 px-4 text-[0.8125rem] text-muted-foreground">{footer}</p>}
    </section>
  )
}

// A row with a title, an optional hint below it and a switch.
export function SwitchRow({
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  title: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
      <span>
        <span className="block text-[1.0625rem]">{title}</span>
        {hint && <span className="block text-[0.8125rem] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

// A row with a title, an optional hint and a few choices below them.
export function ChoiceRow<T extends string | number>({
  title,
  hint,
  options,
  value,
  onChange,
}: {
  title: string
  hint?: string
  options: SegmentedOption<T>[]
  value: T | undefined
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span>
        <span className="block text-[1.0625rem]">{title}</span>
        {hint && <span className="block text-[0.8125rem] text-muted-foreground">{hint}</span>}
      </span>
      <Segmented label={title} options={options} value={value} onChange={onChange} />
    </div>
  )
}

// A row that leads somewhere: another page, or out to the web (opens in a new tab).
export function LinkRow({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  const className = "flex min-h-12 items-center justify-between gap-4 px-4 py-2 text-[1.0625rem] active:bg-secondary/70"
  if (external) {
    return (
      <a href={href} rel="author noopener" target="_blank" className={className}>
        {children}
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </a>
    )
  }
  return (
    <Link href={href} className={className}>
      {children}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

// A row that opens in place to show more (native <details>, so the text is always in the page).
export function DisclosureRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[1.0625rem] [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4 text-[0.9375rem] leading-relaxed text-muted-foreground">{children}</div>
    </details>
  )
}
