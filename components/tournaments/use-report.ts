"use client"

import { useEffect, useState } from "react"
import { onStorageChange } from "@/lib/storage/db"
import { deliveryStatus, type DeliveryStatus } from "@/lib/sync/outbox"
import { loadBoardDevice } from "@/lib/tournaments/store"

// How far this board's result for a slot got: not signed yet or on its first way out
// ("reporting"), tried without reaching relays yet ("waiting"), with relays ("reported": the
// outbox rule met, or every relay has it and the outbox let it go), or refused by every relay
// for good ("refused", which the organizer then enters by hand). Follows the board record and the
// outbox. The result screen and the board screen say the same.
export type Report = "reporting" | "waiting" | "reported" | "refused"

const reportOf = (status: DeliveryStatus | null): Report =>
  !status || status.state === "delivered" ? "reported" : status.state === "refused" ? "refused" : status.attempts > 0 ? "waiting" : "reporting"

export function useReport(tournament: string | null, slot: string | null): Report {
  const [report, setReport] = useState<Report>("reporting")
  useEffect(() => {
    setReport("reporting")
    if (!tournament || !slot) return
    let current = true
    const load = async () => {
      const event = (await loadBoardDevice(tournament))?.games[slot]?.reported?.event
      const next = event ? reportOf(await deliveryStatus(event)) : "reporting"
      if (current) setReport(next)
    }
    void load().catch(() => {})
    const stop = onStorageChange((message) => {
      if (message.type === "change" && (message.stores.includes("pending") || message.stores.includes("outbox"))) void load().catch(() => {})
    })
    return () => {
      current = false
      stop()
    }
  }, [tournament, slot])
  return report
}
