"use client"

import { backupStatus, type BackupStatus } from "@/lib/recovery/status"
import { useStored } from "@/lib/storage/hooks"

// What secures the profile, for the row in Profile, the hint on it and Profil › Sicherung:
// read once, then again whenever it changes in any tab. undefined until read. Mount with
// key={pubkey}: the profile must not change under it.
export function useBackupStatus(pubkey: string): BackupStatus | undefined {
  const [status] = useStored("kv", () => backupStatus(pubkey).catch((): BackupStatus => ({ pubkey, file: null, passkey: null })))
  return status
}
