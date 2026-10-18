import { kvGet, kvSet } from "../storage/db.ts"

// Which ways of getting the signed-in profile back exist, and the hint that asks for one: small
// records in kv "profile.backup*", which go with the profile (lib/profile/session.ts). No
// network and no crypto here, so the rows in Profile read it cheaply; ./backup.ts does the work.
//
// "Gesichert" is said only of the backup file (research DR-20): a passkey alone is lost with the
// passkey.

const STATUS_KEY = "profile.backup"
const HINT_KEY = "profile.backup.hint"

export interface BackupStatus {
  pubkey: string
  // When a backup file was last saved or shared (ms).
  file: { at: number } | null
  // The passkey: when it was set up, its backup event, the key that finds it, and whether the
  // event was read back from a relay (decision 0002 §5).
  passkey: { at: number; event: string; locator: string; confirmed: boolean } | null
}

export async function backupStatus(pubkey: string): Promise<BackupStatus> {
  const stored = await kvGet<BackupStatus>(STATUS_KEY)
  return stored?.pubkey === pubkey ? stored : { pubkey, file: null, passkey: null }
}

export async function updateBackupStatus(pubkey: string, change: Partial<Omit<BackupStatus, "pubkey">>) {
  await kvSet(STATUS_KEY, { ...(await backupStatus(pubkey)), ...change })
}

export const isSecured = (status: BackupStatus) => status.file !== null
const hasBackupMethod = (status: BackupStatus) => status.file !== null || status.passkey !== null

// "Profil sichern" on the own profile shows while no method exists. Put off, it comes back
// after 30 days or 10 more games, whichever is first (design rules, "Keys and sign-in").
const HINT_DAYS = 30
const HINT_GAMES = 10

interface HintDismissal {
  pubkey: string
  at: number
  games: number
}

export const dismissBackupHint = (pubkey: string, games: number, at = Date.now()) => kvSet(HINT_KEY, { pubkey, at, games } satisfies HintDismissal)

export async function backupHintDue(status: BackupStatus, games: number, now = Date.now()): Promise<boolean> {
  if (hasBackupMethod(status)) return false
  const dismissed = await kvGet<HintDismissal>(HINT_KEY)
  if (dismissed?.pubkey !== status.pubkey) return true
  return now - dismissed.at >= HINT_DAYS * 24 * 60 * 60_000 || games >= dismissed.games + HINT_GAMES
}
