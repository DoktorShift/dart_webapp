"use client"

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react"
import { CameraOff, ScanQrCode, VideoOff } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/i18n-provider"
import { containsSecretKey } from "@/lib/shell/links"
import { cn } from "@/lib/utils"

// Scans a QR code with the camera, and always offers typing or pasting the code instead.
//
// - The camera starts on "Code scannen", or right away when the browser already allows it. It
//   asks for the back camera; the torch is never used.
// - Decoding uses the browser's BarcodeDetector where it reads QR codes (Chrome on Android and
//   macOS), otherwise jsQR, loaded only at this point.
// - Denied permission, no camera, an insecure page and a busy camera each get their own message;
//   the field below works in every case.
// - A profile's secret key is never passed on, scanned or typed: the field drops it and says why.
// - The camera stops when a code is accepted, when the scanner closes and while it can't be seen:
//   the page is hidden, another tab is open or another screen covers it. It comes back on when
//   the scanner shows again.
//
// Needs `Permissions-Policy: camera=(self)` (next.config.mjs).

type ScanState = "idle" | "starting" | "scanning" | "denied" | "no-camera" | "unavailable" | "error"

// The answer to a scanned or typed text: a message to show while scanning goes on, or nothing
// when the code was taken (the scanner stops).
export type ScanVerdict = string | void

type Detect = (video: HTMLVideoElement) => Promise<string | null>

interface BarcodeDetectorClass {
  new (options: { formats: string[] }): { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
  getSupportedFormats?: () => Promise<string[]>
}

async function createDetector(): Promise<Detect> {
  const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? ["qr_code"]
      if (formats.includes("qr_code")) {
        const detector = new Native({ formats: ["qr_code"] })
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
      }
    } catch {
      // Present but not working (seen on some Linux builds): use jsQR.
    }
  }
  const { default: jsQR } = await import("jsqr")
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { willReadFrequently: true })
  return async (video) => {
    if (!context || !video.videoWidth) return null
    // About 640 px wide is plenty for a code that fills a good part of the picture, and fast.
    const scale = Math.min(1, 640 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null
  }
}

function stateForError(error: unknown): ScanState {
  const name = (error as { name?: string })?.name
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied"
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-camera"
  return "error"
}

export function QRScanner({
  onResult,
  manualLabel,
  manualPlaceholder,
  checkingText,
  inputMode = "url",
  typeFirst = false,
  className,
}: {
  onResult: (text: string, source: "camera" | "typed") => ScanVerdict | Promise<ScanVerdict>
  // The fallback field: "Code eingeben" (default) or "Link einfügen".
  manualLabel?: string
  manualPlaceholder?: string
  // Shown while a typed entry is being looked up, where that takes a moment.
  checkingText?: string
  inputMode?: "url" | "text" | "numeric"
  // The person chose to type the code: the field is focused (and so scrolled into view), and the
  // camera waits for "Code scannen" even where it is allowed.
  typeFirst?: boolean
  className?: string
}) {
  const t = useT()
  const inputId = useId()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const runRef = useRef(0)
  const resumeRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Whether the camera is on or on its way; read by the visibility handlers below.
  const liveRef = useRef(false)
  const onResultRef = useRef(onResult)
  const [state, setState] = useState<ScanState>("idle")
  // A typed code is being looked up (a verdict that takes a moment).
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [typed, setTyped] = useState("")

  useEffect(() => {
    onResultRef.current = (text, source) => (containsSecretKey(text) ? t.shell.secretKey : onResult(text, source))
    liveRef.current = state === "starting" || state === "scanning"
  })

  const stop = useCallback(() => {
    runRef.current += 1
    clearTimeout(timerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    stop()
    const run = runRef.current
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("unavailable")
      return
    }
    setState("starting")
    setMessage(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      if (run !== runRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      const detect = await createDetector()
      if (run !== runRef.current) return
      setState("scanning")

      let rejected: { text: string; at: number } | null = null
      const tick = async () => {
        if (run !== runRef.current) return
        let text: string | null = null
        try {
          if (video.readyState >= 2) text = await detect(video)
        } catch {
          text = null
        }
        // The same refused code keeps being in view; answer it once, not ten times a second.
        if (text && !(rejected && rejected.text === text && Date.now() - rejected.at < 2500)) {
          const verdict = await onResultRef.current(text, "camera")
          if (run !== runRef.current) return
          if (typeof verdict === "string") {
            setMessage(verdict)
            rejected = { text, at: Date.now() }
          } else {
            stop()
            setState("idle")
            return
          }
        }
        timerRef.current = setTimeout(tick, 150)
      }
      tick()
    } catch (error) {
      if (run !== runRef.current) return
      stop()
      setState(stateForError(error))
    }
  }, [stop])

  // Start straight away where the camera is already allowed; say so where it is blocked.
  useEffect(() => {
    let cancelled = false
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("unavailable")
      return
    }
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((status) => {
        if (cancelled) return
        if (status.state === "granted" && !typeFirst) start()
        else if (status.state === "denied") setState("denied")
      })
      .catch(() => {
        // Safari before 16 and Firefox don't know "camera" here: wait for the button.
      })
    return () => {
      cancelled = true
      stop()
    }
  }, [start, stop, typeFirst])

  // Typing first: the field is focused, and kept in view while the camera card above it settles
  // (its state arrives a moment later and changes its height).
  useEffect(() => {
    if (typeFirst) inputRef.current?.focus({ preventScroll: true })
  }, [typeFirst])
  useEffect(() => {
    const input = inputRef.current
    if (typeFirst && input && input === document.activeElement) input.scrollIntoView({ block: "center" })
  }, [typeFirst, state])

  // The camera is never on while nobody can see the scanner: a hidden page, another tab of the
  // app (tabs stay mounted, display: none) or a screen pushed over this one.
  useEffect(() => {
    const el = rootRef.current
    let seen = true
    const pause = () => {
      if (!liveRef.current) return
      resumeRef.current = true
      stop()
      setState("idle")
    }
    const resume = () => {
      if (!resumeRef.current || document.hidden || !seen) return
      resumeRef.current = false
      start()
    }
    const onVisibility = () => (document.hidden ? pause() : resume())
    document.addEventListener("visibilitychange", onVisibility)
    const observer =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            seen = entry.isIntersecting
            if (seen) resume()
            else pause()
          })
        : null
    if (el) observer?.observe(el)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      observer?.disconnect()
    }
  }, [start, stop])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = typed.trim()
    if (!text || checking) return
    if (containsSecretKey(text)) {
      setTyped("")
      setMessage(t.shell.secretKey)
      return
    }
    setChecking(true)
    try {
      const verdict = await onResult(text, "typed")
      if (typeof verdict === "string") setMessage(verdict)
      else {
        stop()
        setMessage(null)
      }
    } finally {
      setChecking(false)
    }
  }

  const scanning = state === "scanning"
  const blocked: Partial<Record<ScanState, { icon: typeof CameraOff; title: string; text: string; retry?: boolean }>> = {
    denied: { icon: CameraOff, title: t.shell.scanner.deniedTitle, text: t.shell.scanner.deniedText, retry: true },
    "no-camera": { icon: VideoOff, title: t.shell.scanner.noCameraTitle, text: t.shell.scanner.noCameraText },
    unavailable: { icon: VideoOff, title: t.shell.scanner.unavailableTitle, text: t.shell.scanner.unavailableText },
    error: { icon: CameraOff, title: t.shell.scanner.errorTitle, text: t.shell.scanner.errorText, retry: true },
  }
  const problem = blocked[state]

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-4", className)}>
      {/* The camera picture is square; without it the card is only as tall as its text. */}
      <div
        className={cn(
          "relative mx-auto w-full overflow-hidden rounded-3xl",
          scanning || state === "starting" ? "aspect-square max-w-[min(20rem,50dvh)] bg-black" : "border border-border bg-card",
        )}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t.shell.scanner.viewfinder}
          className={cn("absolute inset-0 h-full w-full object-cover", !scanning && "invisible")}
        />
        {scanning && (
          // Corner marks, like the system camera's code frame.
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%]">
            {["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"].map((corner) => (
              <span key={corner} className={cn("absolute h-10 w-10 border-white/90", corner)} />
            ))}
          </div>
        )}
        {!scanning && (
          <div className={cn("flex flex-col items-center justify-center gap-3 p-5 text-center", state === "starting" ? "absolute inset-0 text-white" : "py-7")}>
            {problem ? (
              <>
                <problem.icon className="h-9 w-9 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-[1.0625rem] font-semibold leading-snug">{problem.title}</p>
                <p className="text-[0.875rem] leading-snug text-muted-foreground">{problem.text}</p>
                {problem.retry && (
                  <Button variant="secondary" onClick={start} className="mt-1 h-11 rounded-xl px-5 text-[1.0625rem]">
                    {t.shell.scanner.tryAgain}
                  </Button>
                )}
              </>
            ) : state === "starting" ? (
              <p role="status" className="text-[0.9375rem]">
                {t.shell.scanner.starting}
              </p>
            ) : (
              <>
                <ScanQrCode className="h-12 w-12 text-primary" strokeWidth={1.5} aria-hidden="true" />
                <Button onClick={start} className="h-12 rounded-xl px-6 text-[1.0625rem] font-semibold">
                  {t.shell.scanner.start}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {scanning && (
        <div className="flex flex-col items-center gap-1 text-center">
          <p role="status" className="text-[0.9375rem] text-muted-foreground">
            {t.shell.scanner.hint}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              stop()
              setState("idle")
            }}
            className="h-11 rounded-xl px-4 text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"
          >
            {t.shell.scanner.stop}
          </Button>
        </div>
      )}

      {message && <InlineStatus tone="error">{message}</InlineStatus>}

      <form onSubmit={submit} className="mt-2">
        <label htmlFor={inputId} className="mb-2 block px-4 text-[0.8125rem] text-muted-foreground">
          {manualLabel ?? t.shell.scanner.manualLabel}
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card py-1 pl-4 pr-1">
          <input
            id={inputId}
            ref={inputRef}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setMessage(null)
            }}
            placeholder={manualPlaceholder ?? t.shell.scanner.manualPlaceholder}
            inputMode={inputMode}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-11 min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-hidden placeholder:text-muted-foreground/70"
          />
          <Button type="submit" variant="secondary" disabled={!typed.trim() || checking} className="h-11 shrink-0 rounded-xl px-4 text-[1.0625rem] font-semibold text-primary">
            {t.shell.scanner.submit}
          </Button>
        </div>
        {checkingText && (
          <p role="status" aria-live="polite" className="mt-2 min-h-5 px-4 text-[0.8125rem] text-muted-foreground">
            {checking ? checkingText : ""}
          </p>
        )}
      </form>
    </div>
  )
}
