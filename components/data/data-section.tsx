"use client"

import { useRef, useState, type ReactNode } from "react"
import { Group } from "@/components/ui/group"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useT } from "@/components/i18n-provider"
import type { ImportResult } from "@/lib/storage/data"
import { useStorageUnavailable } from "@/lib/storage/hooks"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Files bigger than this are not an export of this app (a long history is a few megabytes).
const MAX_IMPORT_BYTES = 50 * 1024 * 1024

// Export, import and deleting are loaded when tapped, so they never slow down starting the app.
const loadData = () => import("@/lib/storage/data")

interface Message {
  title: string
  description: string
}

function importMessage(result: ImportResult, t: Messages): Message {
  const d = t.data
  if (!result.ok) {
    if (result.reason === "newer") return { title: d.importNewerTitle, description: d.importNewer }
    if (result.reason === "storage") return { title: d.importStorageTitle, description: d.importStorage }
    return { title: d.importFormatTitle, description: d.importFormat }
  }
  const lines: string[] = []
  const anything = result.added > 0 || result.playersAdded > 0 || result.completed > 0
  if (result.added > 0 || result.playersAdded > 0) lines.push(d.importAdded(result.added, result.playersAdded))
  if (result.completed > 0) lines.push(d.importCompleted(result.completed))
  if (anything && result.known > 0) lines.push(d.importKnown(result.known))
  if (!anything) lines.push(d.importNothing)
  if (result.skipped > 0) lines.push(d.importSkipped(result.skipped))
  return { title: anything ? d.importDoneTitle : d.importNothingTitle, description: lines.join(" ") }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// A row that does something, like the actions in iOS Settings: tinted text, red when destructive.
function ActionRow({ onClick, disabled, destructive, children }: { onClick: () => void; disabled?: boolean; destructive?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-12 w-full items-center px-4 py-2 text-left text-[1.0625rem] active:bg-secondary/70 disabled:opacity-40",
        destructive ? "text-danger" : "text-primary",
      )}
    >
      {children}
    </button>
  )
}

// Settings › Daten: take everything on this device along as a file, bring it back, or delete it.
export function DataSection() {
  const t = useT()
  const d = t.data
  const unavailable = useStorageUnavailable()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const exportData = async () => {
    setBusy(true)
    try {
      const { buildExport, exportFileName } = await loadData()
      const name = exportFileName(d.fileName)
      const blob = new Blob([JSON.stringify(await buildExport(), null, 2)], { type: "application/json" })
      // Phones and tablets get the share sheet (save to Files, AirDrop, mail); an installed app
      // on iOS can't download. Computers download the file.
      const file = new File([blob], name, { type: "application/json" })
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return
        }
      }
      download(blob, name)
    } catch {
      setMessage({ title: d.exportFailedTitle, description: d.exportFailed })
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (file: File) => {
    setBusy(true)
    try {
      const result: ImportResult =
        file.size > MAX_IMPORT_BYTES ? { ok: false, reason: "format" } : await (await loadData()).importData(await file.text())
      setMessage(importMessage(result, t))
    } catch {
      setMessage(importMessage({ ok: false, reason: "format" }, t))
    } finally {
      setBusy(false)
    }
  }

  const wipe = async () => {
    setBusy(true)
    const ok = await loadData()
      .then(({ wipeAllData }) => wipeAllData())
      .catch(() => false)
    // A fresh start: nothing in this page may write the old game or settings back.
    if (ok) window.location.assign("/")
    else {
      setBusy(false)
      setMessage({ title: d.wipeFailedTitle, description: d.wipeFailed })
    }
  }

  return (
    <>
      <Group title={d.title} footer={unavailable ? d.unavailableFooter : d.footer}>
        <ActionRow onClick={exportData} disabled={busy}>
          {d.export}
        </ActionRow>
        <ActionRow onClick={() => fileInput.current?.click()} disabled={busy}>
          {d.import}
        </ActionRow>
        <ActionRow onClick={() => setConfirmWipe(true)} disabled={busy} destructive>
          {d.wipe}
        </ActionRow>
      </Group>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared, so choosing the same file again still counts.
          event.target.value = ""
          if (file) void importFile(file)
        }}
      />

      <AlertDialog open={message !== null} onOpenChange={(open) => !open && setMessage(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{message?.title}</AlertDialogTitle>
            <AlertDialogDescription>{message?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="h-11">{d.ok}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{d.wipeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{d.wipeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void wipe()} className="h-11 bg-danger text-white hover:bg-danger/90">
              {d.wipeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
