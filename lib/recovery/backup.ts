import { query } from "../nostr/client.ts"
import { generalRelays } from "../nostr/relays.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { SessionOptions } from "../profile/session.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { deliverNow, enqueue } from "../sync/outbox.ts"
import { backupFileName, makeBackupFile, newBackupPassword, openBackupFile, type Nip49 } from "./backup-file.ts"
import { applyProfilePackage, buildProfilePackage, type Applied } from "./package.ts"
import { enrollPasskey, locatorPubkey, openPasskeyBackup, PASSKEY_BACKUP_D, passkeyBackupEvent, PasskeyError, unlockPasskey, type PasskeyEnv } from "./passkey.ts"
import { backupStatus, updateBackupStatus, type BackupStatus } from "./status.ts"

// Profil › Sicherung, the work: making the backup file and the passkey backup for the signed-in
// profile, and using either on a new device. What exists is in ./status.ts.

// ---- Backup file ------------------------------------------------------------------------------

export interface PreparedBackup {
  name: string
  text: string
  password: string
}

// The file and its password, both made here, and the file opened again with the password
// before it is offered: what is handed out is known to work.
export async function prepareBackupFile(options: { nip49?: Nip49; logN?: number } = {}): Promise<PreparedBackup> {
  const pkg = await buildProfilePackage()
  const password = newBackupPassword()
  const text = await makeBackupFile(pkg, password, options)
  const back = await openBackupFile(text, password, options.nip49)
  if (back.access.kind !== "local" || pkg.access.kind !== "local" || back.access.key !== pkg.access.key) throw new Error("the backup file doesn't open as written")
  return { name: backupFileName(), text, password }
}

// The person saved or shared the file: known here at once, and noted for the profile's other
// devices where that can be done now (lib/devices/list.ts); otherwise they keep asking until
// one of them makes a file of its own.
export async function markBackupFileSaved(pubkey: string, at = Date.now()) {
  await updateBackupStatus(pubkey, { file: { at } })
  await import("../devices/list.ts").then(({ noteBackupFile }) => noteBackupFile(pubkey, at)).catch(() => {})
}

export async function restoreFromFile(text: string, password: string, options: SessionOptions = {}): Promise<Applied> {
  return applyProfilePackage(await openBackupFile(text, password), options)
}

// ---- Passkey ----------------------------------------------------------------------------------

const backupFilter = (locator: string) => [{ kinds: [KIND_PRIVATE], authors: [locator], "#d": [PASSKEY_BACKUP_D] }]

// Whether the relays hold the backup event now (a fresh query).
async function readBack(locator: string, eventId: string): Promise<boolean> {
  const result = await query(backupFilter(locator), generalRelays())
  return result.events.some((e) => e.id === eventId)
}

// Makes the passkey, proves its PRF, and puts the package on the general relays, signed by
// the locator. Confirmed only once a relay gave it back.
export async function securePasskey(pubkey: string, env: PasskeyEnv, rpName: string): Promise<NonNullable<BackupStatus["passkey"]>> {
  const pkg = await buildProfilePackage()
  const keys = await enrollPasskey(env, { rpName, userName: rpName })
  const event = await passkeyBackupEvent(keys, pkg, nowSeconds())
  const locator = await locatorPubkey(keys)
  await enqueue([{ event, relays: generalRelays() }], { coalesce: true })
  await deliverNow([event.id])
  const passkey = { at: Date.now(), event: event.id, locator, confirmed: await readBack(locator, event.id) }
  await updateBackupStatus(pubkey, { passkey })
  return passkey
}

// Asks the relays again for a passkey backup that wasn't read back yet.
export async function confirmPasskeyBackup(pubkey: string): Promise<boolean> {
  const status = await backupStatus(pubkey)
  if (!status.passkey) return false
  if (status.passkey.confirmed) return true
  const confirmed = await readBack(status.passkey.locator, status.passkey.event)
  if (confirmed) await updateBackupStatus(pubkey, { passkey: { ...status.passkey, confirmed } })
  return confirmed
}

// On a new device: the passkey the person picks finds and opens the backup.
export async function restoreFromPasskey(env: PasskeyEnv, options: SessionOptions = {}): Promise<Applied> {
  const keys = await unlockPasskey(env)
  const locator = await locatorPubkey(keys)
  const result = await query(backupFilter(locator), generalRelays())
  const [event] = result.events
  if (!event) throw new PasskeyError(result.answered.length === 0 ? "offline" : "not-found", "no backup found for this passkey")
  return applyProfilePackage(openPasskeyBackup(event, keys, locator), options)
}
