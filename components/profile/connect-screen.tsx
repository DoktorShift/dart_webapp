"use client"

import { useEffect, useState, type FormEvent } from "react"
import { AppWindow, ExternalLink, Puzzle, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { AccountConfirm } from "@/components/profile/account-confirm"
import { signerProblem } from "@/components/profile/signer-status"
import { useClaimablePlayers } from "@/components/profile/use-profile"
import { generalRelays } from "@/lib/nostr/relays"
import type { Nip46Connection, NostrConnectStart } from "@/lib/nostr/signers"
import { claimPlayer } from "@/lib/profile/claim"
import { connectExternal, type ExternalParams } from "@/lib/profile/session"
import type { ScreenProps } from "@/lib/shell/registry"
import { SITE } from "@/lib/site"

// "Mit einer anderen App": signing in with a profile someone already has elsewhere (P2.02). The
// key stays in that app; BlueLine asks it when something needs a signature.
// - Browser extension (NIP-07): offered where one is installed, or on a computer.
// - Signer app (NIP-46): a code to scan (Amber and others), or a link to paste.
// - Android signer (NIP-55): only on Android; the answer comes back as /#signer-return…,
//   which reopens this screen with the key (params.androidKey, see ./signer-return.ts).
// Before anything is kept, the person confirms the account the signer named. Then, optionally,
// which games on this device are theirs. The existing profile is only read, never overwritten.

// What a signer app is asked to allow right away, so it doesn't ask for each of these.
const PERMISSIONS = ["sign_event:0", "sign_event:10002", "sign_event:30000", "sign_event:31180", "nip44_encrypt", "nip44_decrypt"]

type Method = "extension" | "signer-app" | "android"

const isHexKey = (value: string | undefined): value is string => !!value && /^[0-9a-f]{64}$/.test(value)

function platform() {
  const agent = navigator.userAgent
  const android = /Android/i.test(agent)
  const ios = /iPhone|iPad|iPod/i.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
  const extension = typeof (window as { nostr?: unknown }).nostr === "object"
  // Extensions don't run in an installed iPhone app; on phones they are rare (research DR-14).
  const computer = !android && !ios && window.matchMedia("(pointer: fine)").matches
  return { android, extension: extension || (computer && !(ios && standalone)) }
}

export default function ConnectScreen({ params }: ScreenProps) {
  const t = useT()
  const c = t.profile.connect
  const androidKey = isHexKey(params.androidKey) ? params.androidKey : null
  const [method, setMethod] = useState<Method | null>(androidKey ? "android" : null)
  const [connected, setConnected] = useState<string | null>(null)
  // Known only in the browser; the first render matches the server's.
  const [offers, setOffers] = useState<ReturnType<typeof platform> | null>(null)
  useEffect(() => setOffers(platform()), [])

  if (connected) return <ClaimStep pubkey={connected} />
  if (method === "extension") return <ExtensionStep onConnected={setConnected} onBack={() => setMethod(null)} />
  if (method === "signer-app") return <SignerAppStep onConnected={setConnected} onBack={() => setMethod(null)} />
  if (method === "android") return <AndroidStep returnedKey={androidKey} onConnected={setConnected} onBack={() => setMethod(null)} />

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{c.intro}</p>
      {offers && (
        <Group>
          {offers.extension && <ListRow icon={Puzzle} iconTone="purple" title={c.extension} subtitle={c.extensionHint} onClick={() => setMethod("extension")} />}
          <ListRow icon={AppWindow} iconTone="blue" title={c.signerApp} subtitle={c.signerAppHint} onClick={() => setMethod("signer-app")} />
          {offers.android && <ListRow icon={Smartphone} iconTone="green" title={c.android} subtitle={c.androidHint} onClick={() => setMethod("android")} />}
        </Group>
      )}
    </>
  )
}

// The account to confirm, and what keeping it means.
interface Candidate {
  pubkey: string
  keep: () => Promise<unknown>
  drop?: () => void
}

// Shows the account a signer named and keeps it only after "Ja, das bin ich".
function Confirm({ candidate, onConnected, onDeclined }: { candidate: Candidate; onConnected: (pubkey: string) => void; onDeclined: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const answer = async (yes: boolean) => {
    if (!yes) {
      candidate.drop?.()
      return onDeclined()
    }
    setBusy(true)
    setProblem(null)
    try {
      await candidate.keep()
      onConnected(candidate.pubkey)
    } catch (error) {
      setProblem(signerProblem(t, error))
      setBusy(false)
    }
  }
  return (
    <>
      <AccountConfirm pubkey={candidate.pubkey} busy={busy} onAnswer={(yes) => void answer(yes)} />
      {busy && (
        <p role="status" className="mt-3 text-center text-[0.9375rem] text-muted-foreground">
          {t.profile.connect.connecting}
        </p>
      )}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
    </>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" onClick={onBack} className="mt-4 h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
      {t.common.cancel}
    </Button>
  )
}

function ExtensionStep({ onConnected, onBack }: { onConnected: (pubkey: string) => void; onBack: () => void }) {
  const t = useT()
  const c = t.profile.connect
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void import("@/lib/nostr/signers")
      .then(({ connectNip07 }) => connectNip07())
      .then(
        ({ pubkey }) => alive && setCandidate({ pubkey, keep: () => connectExternal("nip07", { pubkey }) }),
        (error: unknown) => alive && setProblem((error as { code?: string })?.code === "unavailable" ? c.noExtension : signerProblem(t, error)),
      )
    return () => {
      alive = false
    }
    // Once per visit of this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (candidate) return <Confirm candidate={candidate} onConnected={onConnected} onDeclined={onBack} />
  return (
    <>
      {problem ? (
        <InlineStatus tone="error" className="mt-6">
          {problem}
        </InlineStatus>
      ) : (
        <p role="status" className="mt-6 text-[1.0625rem] text-muted-foreground">
          {c.connecting}
        </p>
      )}
      <BackButton onBack={onBack} />
    </>
  )
}

// The code for a signer app to scan (nostrconnect://), or a pasted bunker:// link. A second
// device answering the same code means someone else saw it: a new code replaces it.
function SignerAppStep({ onConnected, onBack }: { onConnected: (pubkey: string) => void; onBack: () => void }) {
  const t = useT()
  const c = t.profile.connect
  const [round, setRound] = useState(0)
  const [uri, setUri] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [pasted, setPasted] = useState("")
  const [pasteProblem, setPasteProblem] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)

  useEffect(() => {
    let alive = true
    let started: NostrConnectStart | null = null
    setUri(null)
    void import("@/lib/nostr/signers").then(async ({ startNostrConnect }) => {
      started = await startNostrConnect({
        relays: generalRelays(),
        perms: PERMISSIONS,
        name: SITE.name,
        url: SITE.url,
        onAuthUrl: (url) => alive && setAuthUrl(url),
        confirm: (account, signal) =>
          new Promise<boolean>((resolve) => {
            signal.addEventListener("abort", () => {
              resolve(false)
              if (alive) setCandidate(null)
            })
            if (!alive) return resolve(false)
            setCandidate({
              pubkey: account.userPubkey,
              keep: async () => {
                resolve(true)
                // The code is on screen, so the start has finished.
                await connectExternal("nip46", { connection: await started!.connection })
              },
              drop: () => resolve(false),
            })
          }),
      })
      if (!alive) return started.cancel()
      setUri(started.uri)
      started.connection.catch((error: unknown) => {
        if (!alive) return
        setCandidate(null)
        // A second answer, a "no", or no scan in ten minutes: start over with a fresh code.
        setNotice((error as { code?: string })?.code === "mismatch" ? c.newCode : null)
        setRound((n) => n + 1)
      })
    })
    return () => {
      alive = false
      started?.cancel()
    }
    // A new code per round; texts don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const paste = async (event: FormEvent) => {
    event.preventDefault()
    if (!pasted.trim().startsWith("bunker://")) return setPasteProblem(c.pasteInvalid)
    setPasting(true)
    setPasteProblem(null)
    try {
      const { connectBunker } = await import("@/lib/nostr/signers")
      const connection: Nip46Connection = await connectBunker(pasted.trim(), { perms: PERMISSIONS, onAuthUrl: setAuthUrl })
      setCandidate({ pubkey: connection.pubkey, keep: () => connectExternal("nip46", { connection } satisfies ExternalParams["nip46"]), drop: () => connection.remote.close() })
    } catch (error) {
      setPasteProblem((error as { code?: string })?.code === "invalid" ? c.pasteInvalid : signerProblem(t, error))
    } finally {
      setPasting(false)
    }
  }

  if (candidate) return <Confirm candidate={candidate} onConnected={onConnected} onDeclined={() => setCandidate(null)} />
  return (
    <>
      {notice && (
        <InlineStatus tone="info" className="mt-4">
          {notice}
        </InlineStatus>
      )}
      <div className="mt-6">
        {uri ? (
          <QRCodeView value={uri} caption={c.qrCaption} label={c.qrLabel} />
        ) : (
          <p role="status" className="py-12 text-center text-[0.9375rem] text-muted-foreground">
            {c.connecting}
          </p>
        )}
      </div>
      {uri && (
        <Button asChild variant="secondary" className="mt-4 h-12 w-full whitespace-normal rounded-xl text-[1.0625rem] text-primary">
          <a href={uri}>{c.openOnPhone}</a>
        </Button>
      )}
      {authUrl && <AuthPage url={authUrl} />}
      <form onSubmit={paste}>
        <TextField
          label={c.pasteLabel}
          value={pasted}
          onChange={(e) => {
            setPasted(e.target.value)
            setPasteProblem(null)
          }}
          placeholder={c.pastePlaceholder}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          error={pasteProblem ?? undefined}
          trailing={
            <Button type="submit" variant="secondary" disabled={pasting || !pasted.trim()} className="h-11 shrink-0 rounded-xl px-4 text-[1.0625rem] font-semibold text-primary">
              {t.shell.scanner.submit}
            </Button>
          }
        />
      </form>
      <BackButton onBack={onBack} />
    </>
  )
}

// A signer app that wants the person to confirm on its own web page.
function AuthPage({ url }: { url: string }) {
  const t = useT()
  return (
    <InlineStatus className="mt-4">
      {t.profile.connect.confirmPage}{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary">
        {t.profile.connect.openConfirmPage}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </InlineStatus>
  )
}

// Android: a link opens the signer app, whose answer comes back as a new address of this app.
function AndroidStep({ returnedKey, onConnected, onBack }: { returnedKey: string | null; onConnected: (pubkey: string) => void; onBack: () => void }) {
  const t = useT()
  const c = t.profile.connect
  const [url, setUrl] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    if (returnedKey && !declined) return
    let alive = true
    void import("@/lib/profile/android-signer").then(({ preparePublicKeyRequest }) => preparePublicKeyRequest()).then((link) => alive && setUrl(link), () => {})
    return () => {
      alive = false
    }
  }, [returnedKey, declined])

  if (returnedKey && !declined) {
    return <Confirm candidate={{ pubkey: returnedKey, keep: () => connectExternal("nip55", { pubkey: returnedKey }) }} onConnected={onConnected} onDeclined={() => setDeclined(true)} />
  }
  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{c.androidHint}</p>
      <Button asChild disabled={!url} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        <a href={url ?? undefined} onClick={() => setOpened(true)}>
          {c.androidOpen}
        </a>
      </Button>
      {opened && (
        <p role="status" className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground">
          {c.androidWaiting}
        </p>
      )}
      <BackButton onBack={onBack} />
    </>
  )
}

// After signing in: which games on this device are the person's, if any (PLAN.md: local results
// are taken over deliberately, never by name). "Später" keeps them apart.
function ClaimStep({ pubkey }: { pubkey: string }) {
  const t = useT()
  const c = t.profile.connect
  const nav = useNav()
  const { candidates, loaded } = useClaimablePlayers()
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nothingToClaim = loaded && candidates.length === 0

  const finish = async (playerId: string | null) => {
    setBusy(true)
    try {
      if (playerId) await claimPlayer(playerId, pubkey)
    } finally {
      nav.popToRoot("profile")
    }
  }

  useEffect(() => {
    if (nothingToClaim) nav.popToRoot("profile")
  }, [nothingToClaim, nav])

  if (!loaded || nothingToClaim) return null
  return (
    <section className="mt-6">
      <h2 className="text-xl font-semibold leading-tight">{c.claimTitle}</h2>
      <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{c.claimHint}</p>
      <ChoiceList
        className="mt-4"
        label={c.claimTitle}
        options={candidates.map((s) => ({ value: s.playerId as string, title: s.name, subtitle: t.profile.gamesCount(s.games) }))}
        value={choice}
        onChange={setChoice}
      />
      <div className="mt-6 grid gap-2">
        <Button disabled={!choice || busy} onClick={() => void finish(choice)} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
          {c.done}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void finish(null)} className="h-11 rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
          {c.claimNone}
        </Button>
      </div>
    </section>
  )
}
