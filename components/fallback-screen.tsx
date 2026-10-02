"use client"

import { Dartboard } from "@/components/dartboard"

// A calm full-screen message for the rare moment something goes wrong. No technical details,
// just what happened in darts terms and one or two clear ways forward.
export function FallbackScreen({
  title,
  message,
  actions,
}: {
  title: string
  message: string
  actions: { label: string; onClick: () => void; primary?: boolean }[]
}) {
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Dartboard variant="mini" className="h-24 w-24" />
        <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[1.0625rem] text-muted-foreground">{message}</p>
        <div className="mt-8 grid w-full gap-2 empty:hidden">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={
                action.primary
                  ? "h-14 rounded-2xl bg-primary text-[1.0625rem] font-semibold text-primary-foreground active:bg-primary/80"
                  : "h-12 rounded-2xl text-[1.0625rem] text-primary active:bg-secondary"
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
