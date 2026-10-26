"use client"

import { useCallback, useEffect, useState } from "react"
import { saveFile } from "@/lib/save-file"
import { shareFile } from "@/lib/shell/share-file"

// Shares a picture through the phone's share sheet, like the result (components/game/
// use-share-result.ts): drawn ahead once the screen has settled, because browsers open the share
// sheet only straight after a tap; without a share sheet for files, or when sharing is refused,
// the picture is saved instead. `make` must keep its identity while the picture stays the same
// (useCallback), and is null while there is nothing to share.
const toFile = (blob: Blob, fileName: string) => new File([blob], fileName, { type: "image/png" })

export function useShareImage(make: (() => Promise<Blob>) | null, fileName: string, text: string) {
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    setFile(null)
    if (!make) return
    let cancelled = false
    const timer = setTimeout(() => {
      make()
        .then((blob) => !cancelled && setFile(toFile(blob, fileName)))
        .catch(() => {
          // No picture yet: a tap draws it then.
        })
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [make, fileName])

  return useCallback(() => {
    if (!make) return
    const send = (picture: File) =>
      void shareFile(picture, text).then((outcome) => {
        if (outcome === "blocked" || outcome === "failed") saveFile(picture, picture.name)
      })
    if (file) send(file)
    else make().then((blob) => send(toFile(blob, fileName))).catch(() => {})
  }, [file, make, fileName, text])
}
