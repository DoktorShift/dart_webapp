"use client"

import { useEffect, useRef, useState } from "react"
import { copyText } from "@/lib/shell/share"

// A copy confirmed in place: `copied` is true for a moment after `copy` (or `show`, for a copy
// made elsewhere), then reads as before. No toast. `copy` resolves whether copying worked.
export function useCopied() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = () => {
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }
  const copy = async (text: string) => {
    const done = await copyText(text)
    if (done) show()
    return done
  }
  return { copied, copy, show }
}
