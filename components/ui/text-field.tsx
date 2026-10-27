"use client"

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react"
import { useT } from "@/components/i18n-provider"
import { containsSecretKey } from "@/lib/shell/links"
import { cn } from "@/lib/utils"

// A labelled text field in the inset grouped style: the label above in footnote size, the field
// in a rounded card, a hint or a problem below (the problem in red with its own words, so it
// never relies on colour alone). A profile's secret key typed or pasted into it is dropped, with
// a warning: the field keeps what it had.
export function TextField({
  label,
  hint,
  error,
  trailing,
  className,
  onChange,
  ...input
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  // A button inside the field on the right, e.g. "Hinzufügen".
  trailing?: ReactNode
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">) {
  const t = useT()
  const id = useId()
  // A profile's secret key never gets into a field, whatever the field is for.
  const [refused, setRefused] = useState(false)
  const problem = refused ? t.shell.secretKey : error
  return (
    <div className={cn("mt-6", className)}>
      <label htmlFor={id} className="mb-2 block px-4 text-[0.8125rem] text-muted-foreground">
        {label}
      </label>
      <div className={cn("flex items-center gap-2 rounded-2xl border bg-card py-1 pl-4", trailing ? "pr-1" : "pr-4", problem ? "border-danger" : "border-border")}>
        <input
          id={id}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || hint ? `${id}-note` : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-hidden placeholder:text-muted-foreground/60"
          onChange={(event) => {
            const secret = containsSecretKey(event.target.value)
            setRefused(secret)
            if (!secret) onChange?.(event)
          }}
          {...input}
        />
        {trailing}
      </div>
      {(problem || hint) && (
        <p id={`${id}-note`} role={problem ? "alert" : undefined} className={cn("mt-2 px-4 text-[0.8125rem] leading-snug", problem ? "text-danger" : "text-muted-foreground")}>
          {problem ?? hint}
        </p>
      )}
    </div>
  )
}
