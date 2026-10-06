"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import { registerSlotItem, registerStartTask } from "@/lib/shell/registry"

// Where the sync area plugs into the shell (imported by components/shell/extensions.ts): its part
// of Profil › Erweitert, and the background service (outbox, private history) once the app is up.
// Everything loads on demand: the start page carries these two lines and nothing of lib/sync.

registerSlotItem("profile.advanced", "sync", lazyScreen<{ pubkey: string }>(() => import("@/components/sync/advanced-section")))

registerStartTask(() => {
  void import("@/lib/sync/service").then(({ startSyncService }) => startSyncService())
})
