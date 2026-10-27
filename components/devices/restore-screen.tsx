"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { FileLock2, Fingerprint } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { TextField } from "@/components/ui/text-field"
import { useAreaT } from "@/components/i18n-provider"
import { ProfileArrived } from "@/components/devices/profile-arrived"
import { useSignInGuard } from "@/components/profile/sign-in-guard"
import { BACKUP_TEXTS, type BackupTexts } from "@/lib/i18n/features/backup.screens"
import type { SessionOptions } from "@/lib/profile/session"
import type { Applied } from "@/lib/recovery/package"

// "Aus meiner Sicherung" (P2.04), on a new device: the backup file with its password, or the
// passkey where one can work. With another profile signed in here, the person decides first
// whether it goes (components/profile/sign-in-guard.tsx). Then the profile is here and its
// games follow (./profile-arrived.tsx).
export default function RestoreScreen() {
  const r = useAreaT(BACKUP_TEXTS).restore
  const { signIn, dialog } = useSignInGuard()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState<"file" | "passkey" | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [passkeys, setPasskeys] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void import("@/lib/recovery/passkey").then(({ passkeySupport }) => passkeySupport()).then((support) => alive && setPasskeys(support === "possible"), () => {})
    return () => {
      alive = false
    }
  }, [])

  // Runs a restore under the sign-in guard; false when the person kept the profile here.
  const restore = async (kind: "file" | "passkey", open: (options: SessionOptions) => Promise<Applied>) => {
    setBusy(kind)
    setProblem(null)
    try {
      let result: Applied | null = null
      if (await signIn(async (options) => (result = await open(options)))) setApplied(result)
    } catch (error) {
      setProblem(problemText(r, error))
    } finally {
      setBusy(null)
    }
  }
  const openFile = (event: FormEvent) => {
    event.preventDefault()
    if (!file || !password.trim() || busy) return
    void restore("file", async (options) => {
      const [{ restoreFromFile }, text] = await Promise.all([import("@/lib/recovery/backup"), file.text()])
      return restoreFromFile(text, password.trim(), options)
    })
  }
  const openPasskey = () => {
    if (busy) return
    void restore("passkey", async (options) => {
      const [{ restoreFromPasskey }, { browserPasskeys, PasskeyError }] = await Promise.all([import("@/lib/recovery/backup"), import("@/lib/recovery/passkey")])
      const env = browserPasskeys()
      if (!env) throw new PasskeyError("unsupported", "no passkeys here")
      return restoreFromPasskey(env, options)
    })
  }

  if (applied) return <ProfileArrived applied={applied} />
  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{r.intro}</p>
      <form onSubmit={openFile} className="mt-6">
        <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{r.fileTitle}</h2>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setProblem(null)
          }}
        />
        <Button type="button" variant="secondary" onClick={() => input.current?.click()} className="h-12 w-full justify-start gap-3 whitespace-normal rounded-2xl px-4 text-left text-[1.0625rem] text-primary">
          <FileLock2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere">{file ? file.name : r.chooseFile}</span>
        </Button>
        <TextField
          label={r.passwordLabel}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setProblem(null)
          }}
          placeholder={r.passwordPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          className="mt-4"
        />
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        <Button type="submit" disabled={!file || !password.trim() || busy !== null} className="mt-4 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
          {busy === "file" ? r.opening : r.open}
        </Button>
      </form>
      {passkeys && (
        <section className="mt-8">
          <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{r.passkeyTitle}</h2>
          <Button variant="secondary" disabled={busy !== null} onClick={openPasskey} className="h-12 w-full gap-2 rounded-2xl text-[1.0625rem] text-primary">
            <Fingerprint className="h-5 w-5" aria-hidden="true" />
            {busy === "passkey" ? r.opening : r.passkey}
          </Button>
        </section>
      )}
      {dialog}
    </>
  )
}

// What a failed restore says: the file's code, the passkey's, or the one word for the rest.
function problemText(r: BackupTexts["restore"], error: unknown): string {
  const name = (error as { name?: string })?.name
  const code = (error as { code?: string })?.code
  if (name === "BackupFileError") return code === "wrong-password" ? r.wrongPassword : code === "format" ? r.notBackup : code === "newer" ? r.newer : r.damaged
  if (name === "PasskeyError") return code === "cancelled" ? r.cancelled : code === "not-found" ? r.notFound : code === "offline" ? r.offline : code === "damaged" ? r.damaged : r.passkeyUnsupported
  if (name === "PackageError") return r.damaged
  return r.failed
}
