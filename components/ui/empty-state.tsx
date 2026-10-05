import type { ComponentType, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmptyAction {
  label: string
  onClick: () => void
}

// What a screen shows when it has nothing yet (HIG: content that's not there yet): a symbol,
// a title, one sentence, one prominent action and at most one quieter one.
export function EmptyState({
  icon: Icon,
  art,
  title,
  description,
  primary,
  secondary,
  className,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>
  // Instead of an icon, e.g. the mini dartboard.
  art?: ReactNode
  title: string
  description?: ReactNode
  primary?: EmptyAction
  secondary?: EmptyAction
  className?: string
}) {
  // Phones in landscape (xshort) have about 270 pt under the tab's title: the symbol steps aside
  // and the two buttons sit side by side, so title, sentence and both actions stay above the tab bar.
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-center px-2 pt-10 text-center short:pt-6 xshort:max-w-lg xshort:pt-3", className)}>
      <span className="contents xshort:hidden">
        {art ??
          (Icon && (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-9 w-9" strokeWidth={1.75} aria-hidden />
            </span>
          ))}
      </span>
      <h2 className="mt-5 text-xl font-semibold leading-tight xshort:mt-0">{title}</h2>
      {description && <p className="mt-2 text-[0.9375rem] leading-snug text-muted-foreground">{description}</p>}
      {(primary || secondary) && (
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2 xshort:mt-4 xshort:max-w-none xshort:flex-row xshort:flex-wrap xshort:justify-center">
          {primary && (
            <Button onClick={primary.onClick} className="h-12 w-full rounded-xl px-6 text-[1.0625rem] font-semibold xshort:w-auto">
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button
              variant="ghost"
              onClick={secondary.onClick}
              className="h-11 w-full rounded-xl px-6 text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary xshort:h-12 xshort:w-auto"
            >
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
