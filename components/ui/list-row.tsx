import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

// Rows for an inset grouped list (put them in a <Group>), in the iOS Settings style:
//
//   <ListRow title="Einstellungen" icon={Settings} onClick={…} />          navigation, with chevron
//   <ListRow title="Spiele" value="12" />                                  a value on the right
//   <ListRow title="Rangliste zurücksetzen" destructive onClick={…} />     red, no chevron
//
// Long titles and values wrap; nothing is cut off with an ellipsis.

export type RowTone = "blue" | "gray" | "green" | "orange" | "red" | "purple" | "teal"

// Filled squares behind row icons; white glyphs stay readable on each of them in both modes.
const TONES: Record<RowTone, string> = {
  blue: "bg-[#0a7aff]",
  gray: "bg-[#8e8e93] dark:bg-[#636366]",
  green: "bg-[#2fb553]",
  orange: "bg-[#f08a00]",
  red: "bg-[#f0453a]",
  purple: "bg-[#9b51e0]",
  teal: "bg-[#1e9fbf]",
}

export function RowIcon({ icon: Icon, tone = "blue" }: { icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone?: RowTone }) {
  return (
    <span className={cn("flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-lg text-white", TONES[tone])}>
      <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden />
    </span>
  )
}

interface ListRowProps {
  title: ReactNode
  // A second line below the title, in the footnote style.
  subtitle?: ReactNode
  // Text on the trailing side, e.g. "12" or "Automatisch".
  value?: ReactNode
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  iconTone?: RowTone
  // A button row when set; otherwise a link row with `href`, otherwise plain.
  onClick?: () => void
  href?: string
  // Red text for an action that removes something. It never shows a chevron; confirm with an
  // AlertDialog before acting.
  destructive?: boolean
  // Defaults to true for rows that lead somewhere (onClick or href) and are not destructive.
  chevron?: boolean
  disabled?: boolean
  // Anything else on the trailing side (a switch, a status badge with text).
  trailing?: ReactNode
  className?: string
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconTone,
  onClick,
  href,
  destructive = false,
  chevron,
  disabled = false,
  trailing,
  className,
}: ListRowProps) {
  const interactive = Boolean(onClick || href)
  const showChevron = chevron ?? (interactive && !destructive)
  const classes = cn(
    "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-[1.0625rem]",
    interactive && "transition-colors active:bg-secondary/70 focus-visible:bg-secondary/50 focus-visible:outline-none disabled:opacity-40",
    destructive && "text-danger",
    className,
  )
  const body = (
    <>
      {icon && <RowIcon icon={icon} tone={iconTone} />}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block leading-snug">{title}</span>
        {subtitle && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="max-w-[50%] shrink-0 text-right tabular-nums text-muted-foreground [overflow-wrap:anywhere]">{value}</span>}
      {trailing}
      {showChevron && <ChevronRight className="-mr-1 h-5 w-5 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={classes}>
        {body}
      </button>
    )
  }
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    )
  }
  return <div className={classes}>{body}</div>
}
