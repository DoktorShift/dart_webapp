import { getSession } from "../profile/session.ts"
import { getSyncStatus, subscribeSyncStatus } from "../sync/status.ts"
import { deviceName } from "./device-name.ts"
import { addThisDevice } from "./list.ts"

// This device writes itself into its profile's device list (./list.ts) once it synced: after
// every sync here that read the relays, until it is in, whatever screen is open or closed by
// then (a new device after a pairing or a restore, the first device of a profile). Only with a
// key kept here: a signer app would be asked to sign out of the blue, so such a device puts
// itself in when Profil › Geräte opens. Started by components/devices/register.ts.
export function listSelfAfterSyncs(): () => void {
  let tried: number | null = null
  return subscribeSyncStatus(() => {
    const { pubkey, running, endedAt, state } = getSyncStatus()
    const session = getSession()
    if (running || endedAt === null || endedAt === tried || !pubkey || (state !== "complete" && state !== "partial")) return
    if (session?.pubkey !== pubkey || session.kind !== "local") return
    tried = endedAt
    // Not in yet (no data key, no relay answered): the next sync tries again.
    addThisDevice(pubkey, deviceName()).catch(() => {})
  })
}
