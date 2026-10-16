"use client";

import { lazyScreen } from "@/components/nav/lazy-screen";
import { featureOn } from "@/lib/shell/features";
import { SESSION_KEY } from "@/lib/profile/storage-keys";
import { registerSlotItem, registerStartTask } from "@/lib/shell/registry";
import { dbGet, dbKeys, onStorageChange } from "@/lib/storage/db";

// Where the sync area plugs into the shell (imported by components/shell/extensions.ts): its part
// of Profil › Erweitert, and the background service (outbox, private history). Everything loads
// on demand: the start page carries these lines and nothing of lib/sync or lib/profile, and a
// guest with nothing to send never loads the service (decision 0002 §1). Off by the feature
// switch (lib/shell/features.ts), nothing here is registered. It starts once a
// profile is stored (now, or when one signs in later) or the outbox holds something from before.

if (featureOn("sync")) {
  registerSlotItem(
    "profile.advanced",
    "sync",
    lazyScreen<{ pubkey: string }>(
      () => import("@/components/sync/advanced-section"),
    ),
  );

  const wanted = async () =>
    (await dbGet("kv", SESSION_KEY)) !== undefined ||
    (await dbKeys("outbox")).length > 0;

  registerStartTask(() => {
    let started = false;
    const start = () => {
      started = true;
      void import("@/lib/sync/service").then(({ startSyncService }) =>
        startSyncService(),
      );
    };
    const look = () =>
      void wanted().then(
        (yes) => yes && !started && start(),
        () => {},
      );
    // A sign-in writes the session; a guest feature that queues something writes the outbox.
    const stop = onStorageChange((message) => {
      if (started) stop();
      else if (
        message.type === "change" &&
        message.stores.some((store) => store === "kv" || store === "outbox")
      )
        look();
    });
    look();
  });
}
