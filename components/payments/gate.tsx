"use client"

import { lazy, type ComponentType } from "react"
import { paymentsInUse, type PaymentsUse } from "@/lib/payments/in-use"
import { useStored } from "@/lib/storage/hooks"

// Payments' pieces in places everyone sees (the result of a game, the Profile list) load only when
// `shows` says so: where payments are in use on this device, or where the piece needs them itself
// (a game with a stake). Until then the gate reads two database entries and renders nothing, so a
// guest who never used payments loads nothing of them.
export function whenInUse<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, shows: (use: PaymentsUse, props: P) => boolean): ComponentType<P> {
  const Piece = lazy(load)
  return function PaymentsGate(props: P) {
    const [use] = useStored(["kv", "payments"], paymentsInUse)
    return use && shows(use, props) ? <Piece {...props} /> : null
  }
}
