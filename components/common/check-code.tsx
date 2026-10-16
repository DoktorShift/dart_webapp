// The check code two devices show each other (a handoff, a pairing): four digits, a space, four
// digits, large enough to compare at arm's length. `label` says what it is, in the area's words.
// On short screens the box is tighter, so the buttons that follow it stay in view.
export function CheckCode({ code, label }: { code: string; label: string }) {
  return (
    <p className="rounded-2xl border border-border bg-card px-4 py-5 text-center short:py-3">
      <span className="block text-[0.8125rem] text-muted-foreground">{label}</span>
      <span className="mt-1 block font-display text-4xl font-semibold tabular-nums tracking-wider">{code}</span>
    </p>
  )
}
