"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Confirm } from "@/components/ui/confirm"
import { Group } from "@/components/ui/group"
import { useT } from "@/components/i18n-provider"
import type { ImportResult } from "@/lib/storage/data"
import { useStorageUnavailable } from "@/lib/storage/hooks"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { saveFile } from "@/lib/save-file"
import { offersFileShare, shareFile } from "@/lib/shell/share"

// Files bigger than this are not an export of this app (a long history is a few megabytes).
const MAX_IMPORT_BYTES = 50 * 1024 * 1024

// Export, import and deleting are loaded with this screen, never with the app, so they don't
// slow down starting it.
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
  const skipped = result.skipped > 0 ? d.importSkipped(result.skipped) : ""
  const join = (...lines: string[]) => lines.filter(Boolean).join(" ")
  if (result.added > 0 || result.playersAdded > 0 || result.completed > 0) {
    return {
      title: d.importDoneTitle,
      description: join(
        result.added > 0 || result.playersAdded > 0 ? d.importAdded(result.added, result.playersAdded) : "",
        result.completed > 0 ? d.importCompleted(result.completed) : "",
        result.known > 0 ? d.importKnown(result.known) : "",
        skipped,
      ),
    }
  }
  // Nothing new: because it is all here already, or because nothing in the file could be used.
  if (result.known > 0 || result.playersKnown > 0)
    return { title: d.importNothingTitle, description: skipped ? join(skipped, d.importRestKnown) : d.importNothing }
  return { title: d.importNoneTitle, description: skipped || d.importEmpty }
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
  // An export ready to share with a tap of its own.
  const [prepared, setPrepared] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Loaded with this screen, so a tap on "Daten exportieren" only has to read the data and the
  // share sheet can usually still open within that tap.
  useEffect(() => {
    void loadData().catch(() => undefined)
  }, [])

  const exportData = async () => {
    setBusy(true)
    try {
      const { buildExport, exportFileName } = await loadData()
      const name = exportFileName(d.fileName)
      const file = new File([JSON.stringify(await buildExport(), null, 2)], name, { type: "application/json" })
      // Phones and tablets get the share sheet; computers download the file. Preparing a long
      // history can take longer than a tap allows: then a second tap shares it.
      if (offersFileShare(file)) {
        const shared = await shareFile(file)
        if (shared === "blocked") setPrepared(file)
        if (shared !== "failed") return
      }
      saveFile(file, name)
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

      <Confirm
        open={prepared !== null}
        onOpenChange={(open) => !open && setPrepared(null)}
        title={d.exportReadyTitle}
        text={d.exportReady}
        confirm={d.shareFile}
        onConfirm={() => {
          // Right in this tap, which the browser accepts.
          const file = prepared
          if (!file) return
          void shareFile(file).then((shared) => {
            if (shared === "blocked" || shared === "failed") saveFile(file, file.name)
          })
        }}
      />

      <Confirm
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title={d.wipeTitle}
        text={d.wipeDescription}
        confirm={d.wipeConfirm}
        destructive
        onConfirm={() => void wipe()}
      />
    </>
  )
}
