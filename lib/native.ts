"use client"

// The iOS app's native parts, behind the same calls the website makes: the share sheet for files
// and links (WKWebView has no downloads, and <a download> does nothing there) and haptics in
// place of navigator.vibrate. The plugins are imported only when called, and only the iOS build
// calls them (lib/platform.ts), so the website never loads them.

export type NativeShareOutcome = "shared" | "dismissed" | "failed"

// The plugin rejects with "Share canceled" when the sheet is closed without picking anything.
const cancelled = (error: unknown) => /cancel/i.test(String((error as { message?: string })?.message ?? error))

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    // "data:<type>;base64,<data>": the plugin wants the part after the comma.
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "")
    reader.readAsDataURL(blob)
  })
}

// Writes the file to the app's cache and opens the share sheet with it (Save to Files, AirDrop,
// Mail, Photos for pictures). The cache is the system's to clear.
export async function shareFileNatively(blob: Blob, name: string, text?: string): Promise<NativeShareOutcome> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")])
    const { uri } = await Filesystem.writeFile({ path: name, data: await base64Of(blob), directory: Directory.Cache, recursive: true })
    try {
      await Share.share({ files: [uri], ...(text ? { text } : {}) })
      return "shared"
    } catch (error) {
      return cancelled(error) ? "dismissed" : "failed"
    }
  } catch {
    return "failed"
  }
}

export async function shareLinkNatively(data: { url: string; title?: string; text?: string }): Promise<NativeShareOutcome> {
  try {
    const { Share } = await import("@capacitor/share")
    await Share.share(data)
    return "shared"
  } catch (error) {
    return cancelled(error) ? "dismissed" : "failed"
  }
}

// navigator.vibrate patterns (lib/game/announce.ts), felt as iOS haptics: one short pulse is a
// tap (a dart, a key); the bust pattern opens with a firm pulse and is a warning; the other
// patterns (leg, set, match) are a success.
export function hapticNatively(pattern: number | number[]) {
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      if (!Array.isArray(pattern) || pattern.length < 2) return Haptics.impact({ style: ImpactStyle.Light })
      return Haptics.notification({ type: pattern[0] >= 30 ? NotificationType.Warning : NotificationType.Success })
    })
    .catch(() => {
      // No haptics on this device (iPad): stay quiet, as the website does.
    })
}
