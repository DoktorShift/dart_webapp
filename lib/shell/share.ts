// Sharing a link: the system share sheet where there is one (phones, tablets, Safari on the Mac),
// otherwise copying it. The result tells the caller what to confirm in place; there are no toasts.
// The browser objects are passed in, so the rules run in the Node unit tests. Files: ./share-file.ts.

import { shareLinkNatively } from "../native.ts"
import { isNativeApp } from "../platform.ts"

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

const browser = (): ShareEnv => (typeof window === "undefined" ? {} : { navigator, document })

export const canShareNatively = (env: ShareEnv = browser()) => isNativeApp() || typeof env.navigator?.share === "function"

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
  // The iOS app opens the native share sheet (the env is the browser's only).
  if (!options.copy && isNativeApp() && env.navigator === browser().navigator) {
    const outcome = await shareLinkNatively(data)
    if (outcome !== "failed") return outcome
  }
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
