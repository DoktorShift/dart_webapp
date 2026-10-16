// Sharing a file (a result picture, an export, a backup) through the share sheet; the caller saves
// the file where there is none. Apart from ./share.ts so the game's result screen, which is on the
// start path, carries only this. The browser objects are passed in, so the rules run in the Node
// unit tests.

interface FileData {
  files: File[]
  text?: string
}

interface FileShareEnv {
  navigator?: {
    share?: (data: FileData) => Promise<void>
    canShare?: (data: FileData) => boolean
  }
}

const browser = () => (typeof window === "undefined" ? {} : { navigator })

// Whether to offer the share sheet for a file: on phones and tablets whose share sheet takes
// files (save to Files, AirDrop, mail; an installed app on iOS can't download). Computers save it.
export const offersFileShare = (file: File) =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] }) === true

// Hands a file to the share sheet. "dismissed": the sheet was closed; "blocked": the browser
// wants a tap of its own (preparing took longer than a tap allows); "failed": no share sheet takes
// the file here, or it broke. Call it right in the tap, before anything else is awaited.
export async function shareFile(file: File, text?: string, env: FileShareEnv = browser()): Promise<"shared" | "dismissed" | "blocked" | "failed"> {
  const nav = env.navigator
  const data: FileData = text ? { files: [file], text } : { files: [file] }
  if (typeof nav?.share !== "function" || (nav.canShare && !nav.canShare(data))) return "failed"
  try {
    await nav.share(data)
    return "shared"
  } catch (error) {
    const name = (error as { name?: string })?.name
    return name === "AbortError" ? "dismissed" : name === "NotAllowedError" ? "blocked" : "failed"
  }
}
