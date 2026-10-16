"use client"

import { MonitorSmartphone } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { DEVICES_SCREENS } from "@/components/devices/screens"
import { useSession } from "@/lib/profile/session"

// "Geräte" in the Profile tab ("profile.rows"): the profile's devices. Nothing for a guest.
export default function DevicesRow() {
  const t = useT()
  const nav = useNav()
  const session = useSession()
  if (!session) return null
  return <ListRow icon={MonitorSmartphone} iconTone="green" title={t.devices.titles.list} onClick={() => nav.push(DEVICES_SCREENS.list)} />
}
