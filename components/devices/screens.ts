// The devices area's own screens (registered in ./register.ts), for push(). The shell's ids
// (profile.fromDevice, profile.fromBackup, devices.pair) are in lib/shell/registry.ts.
export const DEVICES_SCREENS = {
  list: "devices.list",
  backup: "devices.backup",
} as const
