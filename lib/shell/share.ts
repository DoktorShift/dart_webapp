// Sharing a link: the system share sheet where there is one (phones, tablets, Safari on the Mac),
// otherwise copying it. Sharing a file (a result picture, an export, a backup): the share sheet,
// the caller saves the file where there is none. The result tells the caller what to confirm in
// place; there are no toasts. The browser objects are passed in, so the rules run in the Node
// unit tests.

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed"

export interface ShareData {
  url: string
  title?: string
  text?: string
}

interface ShareEnv {
  navigator?: {
    share?: (data: ShareData) => Promise<void>
    canShare?: (data: ShareData) => boolean
    clipboard?: { writeText?: (text: string) => Promise<void> }
  }
  document?: {
    createElement: (tag: "textarea") => HTMLTextAreaElement
    body: { appendChild: (node: HTMLTextAreaElement) => unknown; removeChild: (node: HTMLTextAreaElement) => unknown }
    execCommand?: (command: "copy") => boolean
  }
}

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

const browser = () => (typeof window === "undefined" ? {} : { navigator, document })

export const canShareNatively = (env: ShareEnv = browser()) => typeof env.navigator?.share === "function"

export async function copyText(text: string, env: ShareEnv = browser()): Promise<boolean> {
  try {
    if (env.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Blocked (no permission, not focused): try the old way below.
  }
  const doc = env.document
  if (!doc?.execCommand) return false
  const area = doc.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  doc.body.appendChild(area)
  try {
    area.select()
    return doc.execCommand("copy")
  } catch {
    return false
  } finally {
    doc.body.removeChild(area)
  }
}

// Opens the share sheet, or copies when there is none (or `copy` asks for it). Closing the
// share sheet is "dismissed", not an error, and doesn't fall back to copying.
export async function shareLink(data: ShareData, options: { copy?: boolean } = {}, env: ShareEnv = browser()): Promise<ShareOutcome> {
  const nav = env.navigator
  if (!options.copy && typeof nav?.share === "function" && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data)
      return "shared"
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return "dismissed"
      // NotAllowedError and friends: copying still gets the link across.
    }
  }
  return (await copyText(data.url, env)) ? "copied" : "failed"
}

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
