"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Check, Copy, FileLock2, Fingerprint, ShieldAlert, ShieldCheck } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { useCopied } from "@/components/common/use-copied"
import { Waiting } from "@/components/common/waiting"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { useBackupStatus } from "@/components/devices/use-backup"
import { formatDate } from "@/lib/i18n"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { useSession, type Session } from "@/lib/profile/session"
import type { PreparedBackup } from "@/lib/recovery/backup"
import { isSecured } from "@/lib/recovery/status"
import { saveFile } from "@/lib/save-file"
import { offersFileShare, shareFile } from "@/lib/shell/share-file"
import { SITE } from "@/lib/site"

// Profil › Sicherung (P2.04): how the profile stands, the backup file (with its password, shown
// once) and, where a passkey can work, the passkey. "Dein Profil ist gesichert." is said of the
// file only, and only after the person saved or shared it and kept its password
// (lib/recovery/status.ts). A profile
// in a signer app is secured there, and the screen says so instead.
export default function BackupScreen() {
  const session = useSession()
  if (!session) return null
  return <Backup key={session.pubkey} session={session} />
}

const loadBackup = () => import("@/lib/recovery/backup")

function Backup({ session }: { session: Session }) {
  const t = useT()
  const tx = useAreaT(BACKUP_TEXTS)
  const s = tx.screen
  const status = useBackupStatus(session.pubkey)
  const [passkeys, setPasskeys] = useState<"unsupported" | "possible" | null>(null)
  const [fileOpen, setFileOpen] = useState(false)
  const [passkeyOpen, setPasskeyOpen] = useState(false)
  const local = session.kind === "local"
  const unconfirmed = status?.passkey !== null && status?.passkey?.confirmed === false

  useEffect(() => {
    if (!local) return
    let alive = true
    void import("@/lib/recovery/passkey").then(({ passkeySupport }) => passkeySupport()).then((support) => alive && setPasskeys(support), () => alive && setPasskeys("unsupported"))
    return () => {
      alive = false
    }
  }, [local])

  // A passkey backup not read back from a relay yet is asked for again now.
  useEffect(() => {
    if (!unconfirmed) return
    void loadBackup().then(({ confirmPasskeyBackup }) => confirmPasskeyBackup(session.pubkey)).catch(() => {})
  }, [unconfirmed, session.pubkey])

  if (!status) return null
  const date = (ms: number) => formatDate(t, ms, "long")
  const secured = local && isSecured(status)
  const card = !local
    ? { icon: ShieldCheck, title: s.signerTitle, text: s.signerText }
    : secured
      ? { icon: ShieldCheck, title: s.securedTitle, text: s.securedText(date(status.file!.at)) }
      : { icon: ShieldAlert, title: s.notSecuredTitle, text: status.passkey ? s.passkeyOnlyText : s.notSecuredText }

  return (
    <>
      <section className="mt-6 flex items-start gap-4 rounded-2xl border border-border bg-card px-4 py-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${secured || !local ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>
          <card.icon className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.0625rem] font-semibold leading-snug">{card.title}</h2>
          <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{card.text}</p>
        </div>
      </section>

      {local && (
        <Group title={s.methods} footer={s.footer}>
          <ListRow icon={FileLock2} iconTone="blue" title={status.file ? s.fileAgain : s.fileNew} subtitle={status.file ? s.fileDate(date(status.file.at)) : s.fileHint} onClick={() => setFileOpen(true)} />
          {(passkeys === "possible" || status.passkey) && (
            <ListRow
              icon={Fingerprint}
              iconTone="purple"
              title={status.passkey ? s.passkey : s.passkeyNew}
              subtitle={status.passkey ? `${s.passkeyDate(date(status.passkey.at))}${status.passkey.confirmed ? "" : ` · ${s.passkeyUnconfirmed}`}` : s.passkeyHint}
              onClick={() => setPasskeyOpen(true)}
            />
          )}
        </Group>
      )}

      {fileOpen && <FileSheet pubkey={session.pubkey} onClose={() => setFileOpen(false)} />}
      {passkeyOpen && <PasskeySheet pubkey={session.pubkey} onClose={() => setPasskeyOpen(false)} />}
    </>
  )
}

const primary = "h-12 w-full rounded-2xl text-[1.0625rem] font-semibold"
const secondary = "h-12 w-full rounded-2xl text-[1.0625rem]"

type FileStep = { step: "preparing" } | { step: "ready"; backup: PreparedBackup } | { step: "failed" }

// The file is made (and opened again, as a test) as the sheet opens; then the password and the
// file to save or share. The password stays in view until "Fertig", and the profile counts as
// "gesichert" only then: once the file was saved and the password copied or noted (a file
// without its password brings nothing back). The two hidden fields let the phone's password
// manager offer to keep the password, under the file's name.
function FileSheet({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const f = useAreaT(BACKUP_TEXTS).fileSheet
  const [state, setState] = useState<FileStep>({ step: "preparing" })
  const [round, setRound] = useState(0)
  const { copied, copy: copyPassword } = useCopied()
  const [passwordKept, setPasswordKept] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    let alive = true
    setState({ step: "preparing" })
    void loadBackup()
      .then(({ prepareBackupFile }) => prepareBackupFile())
      .then(
        (backup) => alive && setState({ step: "ready", backup }),
        () => alive && setState({ step: "failed" }),
      )
    return () => {
      alive = false
    }
  }, [round])

  // Phones and tablets get the share sheet (Files, AirDrop, mail); computers download.
  useEffect(() => {
    if (state.step !== "ready") return
    const file = fileOf(state.backup)
    setCanShare(offersFileShare(file))
  }, [state])

  const fileOf = (backup: PreparedBackup) => new File([backup.text], backup.name, { type: "application/json" })
  const copy = async (password: string) => {
    if (await copyPassword(password)) setPasswordKept(true)
  }
  const save = (backup: PreparedBackup) => {
    saveFile(fileOf(backup), backup.name)
    setSavedAt(Date.now())
  }
  const share = async (backup: PreparedBackup) => {
    const outcome = await shareFile(fileOf(backup))
    if (outcome === "shared") setSavedAt(Date.now())
    else if (outcome !== "dismissed") save(backup)
  }
  // Saved and the password kept: secured here, and noted for the profile's other devices.
  const secure = async (at: number) => {
    await loadBackup().then(({ markBackupFileSaved }) => markBackupFileSaved(pubkey, at))
    void import("@/lib/devices/list").then(({ noteBackupFile }) => noteBackupFile(pubkey)).catch(() => {})
  }
  const finish = async (event: FormEvent) => {
    event.preventDefault()
    if (savedAt === null) return
    await secure(savedAt)
    onClose()
  }
  // Swiping the sheet away once the file is saved and the password copied is a
  // "Fertig" too; before that, nothing counts as secured.
  const dismiss = () => {
    if (savedAt !== null && passwordKept) void secure(savedAt)
    onClose()
  }

  // Ready, the password scrolls if it must and the buttons stay at the bottom of the sheet.
  return (
    <Sheet open onOpenChange={(open) => !open && dismiss()} title={f.title}>
      {state.step !== "ready" ? (
        <SheetBody>
          {state.step === "preparing" ? (
            <Waiting className="py-8">{f.preparing}</Waiting>
          ) : (
            <div className="grid gap-3 pb-2">
              <InlineStatus tone="error">{f.failed}</InlineStatus>
              <Button onClick={() => setRound((n) => n + 1)} className={primary}>
                {f.retry}
              </Button>
            </div>
          )}
        </SheetBody>
      ) : (
        <form onSubmit={(event) => void finish(event)} className="flex min-h-0 flex-col">
          <input type="text" name="username" autoComplete="username" value={state.backup.name} readOnly hidden />
          <input type="password" name="password" autoComplete="new-password" value={state.backup.password} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
          <SheetBody>
            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-card px-4 py-4">
                <p className="text-[0.8125rem] text-muted-foreground">{f.passwordLabel}</p>
                <Password value={state.backup.password} />
                <Button type="button" variant="secondary" onClick={() => void copy(state.backup.password)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
                  {copied ? <Check className="mr-2 h-5 w-5" aria-hidden="true" /> : <Copy className="mr-2 h-5 w-5" aria-hidden="true" />}
                  {copied ? f.copied : f.copy}
                </Button>
                <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{f.passwordHint}</p>
              </div>
              {savedAt !== null && (
                <>
                  <InlineStatus tone="success">{f.saved}</InlineStatus>
                  <p className="text-[0.9375rem] leading-snug text-muted-foreground">{passwordKept ? f.savedHint : f.passwordCheck}</p>
                </>
              )}
            </div>
          </SheetBody>
          {/* Keyed, so React doesn't turn the tapped "Datei speichern" into "Fertig" while the tap
              is still running: the button would then submit the form at once. */}
          <div className="mt-4 grid shrink-0 gap-2 pb-2">
            {savedAt !== null ? (
              <Button key="finish" type="submit" className={primary}>
                {passwordKept ? f.done : f.noted}
              </Button>
            ) : (
              <>
                {canShare && (
                  <Button key="share" type="button" onClick={() => void share(state.backup)} className={primary}>
                    {f.share}
                  </Button>
                )}
                <Button key="save" type="button" variant={canShare ? "secondary" : "default"} onClick={() => save(state.backup)} className={canShare ? secondary : primary}>
                  {f.save}
                </Button>
              </>
            )}
          </div>
        </form>
      )}
    </Sheet>
  )
}

// The generated password, in large monospace letters, wrapping only between its groups.
function Password({ value }: { value: string }) {
  const groups = value.split("-")
  return (
    <p className="mt-1 select-all font-mono text-[1.25rem] font-semibold leading-snug tracking-wide">
      {groups.map((group, i) => (
        <span key={i} className="inline-block">
          {group}
          {i < groups.length - 1 && "-"}
        </span>
      ))}
    </p>
  )
}

type PasskeyStep = { step: "idle" } | { step: "working" } | { step: "done"; confirmed: boolean } | { step: "problem"; text: string }

// The passkey, set up with one tap: the browser asks for Face ID, Touch ID or the password
// manager twice (once to make it, once to prove it works, lib/recovery/passkey.ts).
function PasskeySheet({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const p = useAreaT(BACKUP_TEXTS).passkeySheet
  const [state, setState] = useState<PasskeyStep>({ step: "idle" })

  const start = async () => {
    setState({ step: "working" })
    try {
      const [{ securePasskey }, { browserPasskeys, PasskeyError }] = await Promise.all([loadBackup(), import("@/lib/recovery/passkey")])
      const env = browserPasskeys()
      if (!env) throw new PasskeyError("unsupported", "no passkeys here")
      const passkey = await securePasskey(pubkey, env, SITE.name)
      setState({ step: "done", confirmed: passkey.confirmed })
    } catch (error) {
      const code = (error as { code?: string })?.code
      setState({ step: "problem", text: code === "cancelled" ? p.cancelled : code === "unsupported" || code === "mismatch" ? p.unsupported : p.failed })
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={p.title} dismissible={state.step !== "working"}>
      <SheetBody>
        <div className="grid gap-4 pb-2">
          {state.step === "done" ? (
            <InlineStatus tone="success">{state.confirmed ? p.done : p.doneUnconfirmed}</InlineStatus>
          ) : (
            <>
              <p className="text-[1.0625rem] leading-snug">{p.text}</p>
              <p className="text-[0.9375rem] leading-snug text-muted-foreground">{p.note}</p>
            </>
          )}
          {state.step === "problem" && <InlineStatus tone="error">{state.text}</InlineStatus>}
          {state.step === "working" ? (
            <Waiting className="py-3">{p.working}</Waiting>
          ) : state.step === "done" ? (
            <Button onClick={onClose} className={primary}>
              {p.close}
            </Button>
          ) : (
            <Button onClick={() => void start()} className={primary}>
              {p.start}
            </Button>
          )}
        </div>
      </SheetBody>
    </Sheet>
  )
}
