import { shareFileNatively } from "./native.ts"
import { isNativeApp } from "./platform.ts"

// Saves a file through the browser's download, where there is no share sheet (or sharing was
// refused). The link is attached for the click, which Firefox needs.
// In the iOS app there are no downloads: the file goes to the share sheet, whose "Save to Files"
// is the way to keep it.
export function saveFile(blob: Blob, name: string) {
  if (isNativeApp()) {
    void shareFileNatively(blob, name)
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
