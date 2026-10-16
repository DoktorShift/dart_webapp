import type { ReactNode } from "react"

// A pairing step on a phone in landscape (xshort), on both sides (./new-device-screen.tsx,
// ./add-device-screen.tsx): what to compare on the left, what to do on the right, so the code
// and the buttons are both in view without scrolling. One column everywhere else.
export function PairColumns({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <div className="mt-2 grid gap-4 xshort:grid-cols-2 xshort:items-start xshort:gap-x-6">
      <div className="grid gap-4">{first}</div>
      <div className="grid gap-4">{second}</div>
    </div>
  )
}
