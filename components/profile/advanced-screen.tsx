"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Check, CircleAlert, CircleCheck, Copy, LoaderCircle, Minus, Plus, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import { signerProblem, SignerConfirmation } from "@/components/profile/signer-status"
import { useOwnProfile, type OwnProfile } from "@/components/profile/use-profile"
import type { RelayEntry } from "@/lib/nostr/ext/lists"
import { generalRelays } from "@/lib/nostr/relays"
import { diagnosticsReport } from "@/lib/profile/diagnostics"
import { changeBase, lookupOwnEvents, OWN } from "@/lib/profile/own-events"
import { addRelay, editableRelays, relayListTemplate, removeRelay } from "@/lib/profile/relay-list"
import { probeRelays, relayHost, type RelayStatus } from "@/lib/profile/relay-status"
import { copyText } from "@/lib/shell/share"
import { submitOwn } from "@/lib/sync/publish"
import { cn } from "@/lib/utils"
import { version } from "@/package.json"

// Profil › Erweitert: the only place that names the technology (decision 0002 §1). The public key
// to copy, how this device signs, the relay list (NIP-65) with how each relay answers now, the
// areas' diagnostics ("profile.advanced") and "Diagnose kopieren". Never a secret key: backups
// have their own, guarded way.
export default function AdvancedScreen() {
  const own = useOwnProfile()
  if (!own) return null
  return <Advanced own={own} />
}

// Copied texts say so for a moment, then read as before.
function useCopied(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    if (!(await copyText(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return [copied, copy]
}

// Each relay's answer, asked again whenever the list changes. null while asking.
function useRelayStatus(urls: readonly string[], pubkey: string) {
  const [status, setStatus] = useState<Map<string, RelayStatus> | null>(null)
  const key = urls.join(",")
  useEffect(() => {
    let alive = true
    setStatus(null)
    void probeRelays(key.split(","), pubkey).then((found) => alive && setStatus(new Map(found.map((s) => [s.url, s]))))
    return () => {
      alive = false
    }
  }, [key, pubkey])
  return status
}

function Advanced({ own }: { own: OwnProfile }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const a = tx.advanced
  const { session, events } = own
  const [npub, setNpub] = useState<string | null>(null)
  const [keyCopied, copyKey] = useCopied()
  const [reportCopied, copyReport] = useCopied()
  const relayList = events?.get(OWN.relayList) ?? null
  // Without a list here, the app's relays stand in only once a relay has said there is none.
  const answered = own.lookup?.answered ?? null
  const listState: ListState = relayList ? "known" : answered === null ? "loading" : answered ? "none" : "failed"
  const entries = listState === "loading" || listState === "failed" ? [] : editableRelays(relayList)
  const status = useRelayStatus(
    entries.map((e) => e.url),
    session.pubkey,
  )

  useEffect(() => {
    let alive = true
    void import("@/lib/nostr/pointers").then(({ npubOf }) => npubOf(session.pubkey)).then((value) => alive && setNpub(value), () => {})
    // Changing the list starts from the newest version: looked up again on opening.
    void lookupOwnEvents(session.pubkey, { again: true })
    return () => {
      alive = false
    }
  }, [session.pubkey])

  // Public facts only (lib/profile/diagnostics.ts).
  const report = () => {
    const at = (kind: string) => {
      const event = events?.get(kind)
      return event ? new Date(event.created_at * 1000).toISOString() : "none here"
    }
    return diagnosticsReport([
      {
        title: "App",
        lines: [`BlueLine Darts ${version}`, `time: ${new Date().toISOString()}`, `language: ${t.lang}`, `installed: ${window.matchMedia("(display-mode: standalone)").matches ? "yes" : "no"}`, `browser: ${navigator.userAgent}`],
      },
      {
        title: "Profile",
        lines: [`access: ${session.kind}`, `npub: ${npub ?? "?"}`, `metadata: ${at(OWN.metadata)}`, `relay list: ${relayList ? at(OWN.relayList) : listState === "none" ? "none (app relays)" : "not loaded"}`, `stats card: ${at(OWN.statsCard)}`],
      },
      {
        title: "Relays",
        lines: entries.map((entry) => {
          const s = status?.get(entry.url)
          return `${entry.url} ${entry.read ? "r" : ""}${entry.write ? "w" : ""} ${s ? (s.problem ? `${s.state} (${s.problem})` : `${s.state} ${s.ms} ms`) : "checking"}`
        }),
      },
    ])
  }

  return (
    <>
      <Group title={a.identity}>
        <ListRow title={a.access} value={a.kinds[session.kind]} />
        <div className="px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[1.0625rem] leading-snug">{a.publicKey}</p>
            <Button
              variant="ghost"
              disabled={!npub}
              onClick={() => npub && void copyKey(npub)}
              className="-mr-3 h-11 shrink-0 gap-1.5 rounded-xl px-3 text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"
            >
              {keyCopied ? <Check className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
              {keyCopied ? a.copied : a.copy}
            </Button>
          </div>
          <p className="select-all break-all pb-1 font-mono text-[0.8125rem] leading-snug text-muted-foreground">{npub}</p>
        </div>
      </Group>

      <RelayList pubkey={session.pubkey} entries={entries} state={listState} status={status} />

      <SlotItems list="profile.advanced" props={() => ({ pubkey: session.pubkey })} />

      <Group footer={a.diagnosticsHint}>
        <ListRow
          icon={reportCopied ? Check : Copy}
          iconTone="gray"
          title={reportCopied ? a.diagnosticsCopied : a.diagnostics}
          chevron={false}
          onClick={() => void report().then(copyReport)}
        />
      </Group>
      <p role="status" className="sr-only">
        {keyCopied || reportCopied ? a.copied : ""}
      </p>
    </>
  )
}

// "known": the profile's own list. "none": it has none, the app's relays show. "loading" and
// "failed": not looked up yet, or no relay answered; nothing to edit.
type ListState = "known" | "none" | "loading" | "failed"

const usage = (tx: ProfileTexts, entry: RelayEntry) => (entry.read && entry.write ? tx.advanced.readWrite : entry.read ? tx.advanced.read : tx.advanced.write)

const STATES = {
  connected: { icon: CircleCheck, className: "text-success" },
  slow: { icon: Timer, className: "text-warning" },
  unreachable: { icon: CircleAlert, className: "text-danger" },
} as const

// A relay's state in words, with a symbol: never colour alone. Without a status yet: being asked.
function RelayState({ status }: { status: RelayStatus | undefined }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const a = tx.advanced
  if (!status) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        {a.states.checking}
      </span>
    )
  }
  const { icon: Icon, className } = STATES[status.state]
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {a.states[status.state]}
    </span>
  )
}

// The profile's relay list as hosts, with their state. Adding publishes a new list at once,
// removing after a confirmation (it is a public change); both on top of the newest version known
// (lib/profile/own-events.ts), and whatever another app wrote into it stays
// (lib/profile/relay-list.ts). The app's relays not on the list are offered with one tap.
function RelayList({ pubkey, entries, state, status }: { pubkey: string; entries: RelayEntry[]; state: ListState; status: Map<string, RelayStatus> | null }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const a = tx.advanced
  const [typed, setTyped] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RelayEntry | null>(null)
  const editable = state === "known" || state === "none"
  const recommended = editable ? generalRelays().filter((url) => !entries.some((e) => e.url === url)) : []

  const save = async (next: RelayEntry[] | null) => {
    if (!next) return false
    setBusy(true)
    setProblem(null)
    try {
      await submitOwn([relayListTemplate(next, await changeBase(pubkey, OWN.relayList))])
      return true
    } catch (error) {
      setProblem(signerProblem(tx, error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const next = addRelay(entries, typed)
    if (!next) return setInvalid(true)
    if (await save(next)) setTyped("")
  }

  return (
    <>
      <Group title={a.relays} footer={!editable ? undefined : entries.length === 1 ? a.lastRelay : state === "known" ? a.relaysFooter : a.defaultRelays}>
        {state === "loading" && (
          <p role="status" className="flex min-h-12 items-center gap-2 px-4 text-[1.0625rem] text-muted-foreground">
            <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            {a.listLoading}
          </p>
        )}
        {state === "failed" && (
          <div className="px-4 py-3">
            <InlineStatus tone="error">{a.listNotLoaded}</InlineStatus>
            <Button variant="secondary" onClick={() => void lookupOwnEvents(pubkey, { again: true })} className="mt-2 h-11 rounded-xl px-5 text-[1.0625rem]">
              {tx.public.retry}
            </Button>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.url} className="flex min-h-12 items-center gap-2 py-1.5 pl-4 pr-1">
            <div className="min-w-0 flex-1">
              <p className="text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">{relayHost(entry.url)}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
                <RelayState status={status?.get(entry.url)} />
                <span aria-hidden="true">·</span>
                {usage(tx, entry)}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || entries.length === 1}
              aria-label={a.remove(relayHost(entry.url))}
              onClick={() => setRemoving(entry)}
              className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white">
                <Minus className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
              </span>
            </button>
          </div>
        ))}
      </Group>
      {recommended.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{a.recommended}</p>
          <div className="flex flex-wrap gap-2 px-1">
            {recommended.map((url) => (
              <button
                key={url}
                type="button"
                disabled={busy}
                onClick={() => void save(addRelay(entries, url))}
                aria-label={a.addHost(relayHost(url))}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 text-[0.9375rem] active:bg-secondary disabled:opacity-40"
              >
                <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="[overflow-wrap:anywhere]">{relayHost(url)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {editable && (
        <form onSubmit={add}>
          <TextField
            label={a.add}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              setInvalid(false)
            }}
            placeholder={a.addPlaceholder}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            error={invalid ? a.invalid : undefined}
            trailing={
              <Button type="submit" variant="secondary" disabled={busy || !typed.trim()} className="h-11 shrink-0 rounded-xl px-4 text-[1.0625rem] font-semibold text-primary">
                {a.addButton}
              </Button>
            }
          />
        </form>
      )}
      <SignerConfirmation />
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{removing && a.removeTitle(relayHost(removing.url))}</AlertDialogTitle>
            <AlertDialogDescription>{a.removeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                const entry = removing
                setRemoving(null)
                if (entry) void save(removeRelay(entries, entry.url))
              }}
            >
              {a.removeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
