// The install guide's structure: which picture each step shows, per kind of device. The step
// texts are in the language catalogs (t.install.steps), one per picture, in the same order.

export type InstallPlatform = "ios" | "android" | "desktop"

export type InstallPicture =
  | "ios-share"
  | "ios-add"
  | "ios-confirm"
  | "home-screen"
  | "android-menu"
  | "android-install"
  | "android-confirm"
  | "desktop-install"
  | "desktop-confirm"
  | "desktop-dock"

export const INSTALL_PICTURES: Record<InstallPlatform, InstallPicture[]> = {
  ios: ["ios-share", "ios-add", "ios-confirm", "home-screen"],
  android: ["android-menu", "android-install", "android-confirm", "home-screen"],
  desktop: ["desktop-install", "desktop-confirm", "desktop-dock"],
}

export const INSTALL_PLATFORMS: InstallPlatform[] = ["ios", "android", "desktop"]

// iPadOS reports itself as a Mac; touch support tells them apart.
export function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "ios"
  if (/Android/i.test(ua)) return "android"
  return "desktop"
}
