"use client"

import { useCallback, useEffect, useState } from "react"
import { renderResultImage, type ResultImage } from "@/lib/result-image"
import { saveFile } from "@/lib/save-file"
import { shareFile } from "@/lib/shell/share"

const FILE_NAME = "blueline-darts.png"
const ICON = "/icon/192"

const makeFile = (model: ResultImage) =>
  renderResultImage(model, ICON).then((blob) => new File([blob], FILE_NAME, { type: "image/png" }))

// Shares the result as a picture through the phone's share sheet (Messages, WhatsApp,
// Instagram). The picture is drawn ahead, once the result screen has settled, because browsers
// only open the share sheet straight after a tap. Where there is no share sheet for files
// (most computers), or sharing is refused, the picture is saved instead. `model` must keep its
// identity between renders (useMemo).
export function useShareResult(model: ResultImage, text: string) {
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    const timer = setTimeout(() => {
      makeFile(model)
        .then((made) => !cancelled && setFile(made))
        .catch(() => {
          // No picture yet: a tap draws it then.
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [model])

  return useCallback(() => {
    const send = (picture: File) =>
      void shareFile(picture, text).then((outcome) => {
        // Closing the share sheet is fine; anything else saves the picture instead.
        if (outcome === "blocked" || outcome === "failed") saveFile(picture, picture.name)
      })
    if (file) send(file)
    else makeFile(model).then(send).catch(() => {})
  }, [file, model, text])
}
