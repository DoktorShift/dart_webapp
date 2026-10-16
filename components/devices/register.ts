"use client"

import { lazy } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { DEVICES_SCREENS } from "@/components/devices/screens"
import { PAIRING_PENDING_PREFIX } from "@/lib/devices/storage-keys"
import { featureOn } from "@/lib/shell/features"
import { SCREENS, registerScreen, registerSlotItem, registerStartTask } from "@/lib/shell/registry"
import { dbKeys } from "@/lib/storage/db"

// Where the devices area (P2.03 pairing and the device list, P2.04 backup and restore) plugs
// into the shell (components/shell/extensions.ts): two rows and the backup hint in Profile, the
// guest's "Von meinem anderen Gerät" and "Aus meiner Sicherung", "Eigenes Gerät hinzufügen"
// (also what a /#pair= link opens), Profil › Geräte and Profil › Sicherung. Everything loads on
// demand: the start page carries this file and nothing of lib/devices or lib/recovery. Off by the
// feature switch (lib/shell/features.ts), nothing here is registered.

if (featureOn("devices")) {
  registerSlotItem("profile.rows", "devices", lazy(() => import("@/components/devices/devices-row")))
  registerSlotItem("profile.rows", "backup", lazy(() => import("@/components/devices/backup-row")))
  registerSlotItem("profile.card", "backup.hint", lazy(() => import("@/components/devices/backup-hint")))

  registerScreen(SCREENS.profileFromDevice, { title: (t) => t.profile.guest.fromDevice, Component: lazyScreen(() => import("@/components/devices/new-device-screen")) })
  registerScreen(SCREENS.profileFromBackup, { title: (t) => t.profile.guest.fromBackup, Component: lazyScreen(() => import("@/components/devices/restore-screen")) })
  registerScreen(SCREENS.devicesPair, { title: (t) => t.devices.titles.add, Component: lazyScreen(() => import("@/components/devices/add-device-screen")) })
  registerScreen(DEVICES_SCREENS.list, { title: (t) => t.devices.titles.list, Component: lazyScreen(() => import("@/components/devices/devices-screen")) })
  registerScreen(DEVICES_SCREENS.backup, { title: (t) => t.backup.titles.backup, Component: lazyScreen(() => import("@/components/devices/backup-screen")) })

  // A pairing that ran out while the app was closed leaves its one-time keys behind: dropped at
  // start. Only a device that paired lately has any; the others load nothing for it.
  registerStartTask(() => {
    void dbKeys("pending")
      .then((keys) => {
        if (keys.some((key) => key.startsWith(PAIRING_PENDING_PREFIX))) return import("@/lib/devices/pairing").then(({ purgeExpiredPairings }) => purgeExpiredPairings())
      })
      .catch(() => {})
  })
}
