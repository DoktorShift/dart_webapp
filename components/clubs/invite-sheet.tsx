"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy, UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Confirm } from "@/components/ui/confirm"
import { ChoiceRow } from "@/components/ui/group"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { SheetCode } from "@/components/common/sheet-code"
import { useCopied } from "@/components/common/use-copied"
import { XSHORT, useMediaQuery } from "@/components/common/use-media-query"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDate } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetButton, useChange } from "@/components/clubs/common"
import { InvitePersonSheet } from "@/components/clubs/invite-person-sheet"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useOwnProfile } from "@/components/profile/use-profile"
import { isManager, nextDate, type ClubView } from "@/lib/clubs/club"
import { clubLink } from "@/lib/clubs/links"
import { createInvite, revokeInvite } from "@/lib/clubs/membership"
import { SITE } from "@/lib/site"
import { nowSeconds } from "@/lib/nostr/time"
import type { ClubInvite, ClubState } from "@/lib/protocol/club-state"
import { formatInviteCode } from "@/lib/protocol/invite"
import { cn } from "@/lib/utils"

// How long a new link is good: the standing link for everyone a year (a reset ends it any
// time), a personal one a week, a month or a year.
const VALIDITY_DAYS = [7, 30, 365] as const
const GROUP_DAYS = 365
const PERSONAL_DAYS = 7

type Code = { invite: string; token: string }

// The group links that still admit people, and among them the one this device made (it knows
// the token): shown again instead of a new record each time the sheet opens.
// The group links a reader may show and end: a leader every leader's link (members' links only
// ask, so a leader never hands those out), a member their own.
const openGroupInvites = (state: ClubState, me: string | null, now: number) => {
  const manager = isManager(me ? (state.members[me]?.role ?? null) : null)
  return Object.values(state.invites).filter((i) => i.kind === "group" && !i.ended && i.expires > now && (manager ? i.maker === "manager" : i.by === me))
}
function standingGroupInvite(state: ClubState, me: string | null, tokens: Record<string, string>, now: number): Code | null {
  const open = openGroupInvites(state, me, now)
    .filter((i) => tokens[i.id])
    .sort((a, b) => b.expires - a.expires)[0]
  return open ? { invite: open.id, token: tokens[open.id] } : null
}

// "Mitglieder einladen" (PLAN.md "Der Einlade-Moment"): the sheet opens with the code already
// on it. The standing link for everyone is made once and shown again each time; a personal
// invitation (one person, confirmed by a leader) and the validity sit under "Optionen", and
// "Link zurücksetzen" ends the standing link and makes a new one at once. The link's secret
// stays on this device: a leader whose link was made elsewhere makes their own. A reset ends
// every open group link of the club, whoever made it, so "the link" is really gone.
export function InviteSheet({
  view,
  state,
  open,
  onOpenChange,
  existing,
}: {
  view: ClubView
  state: ClubState
  open: boolean
  onOpenChange: (open: boolean) => void
  // Show the code of an invitation made here, instead of the standing link.
  existing?: Code | null
}) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const xshort = useMediaQuery(XSHORT)
  // The host's name in the preview: as this profile is called here, known at once.
  const own = useOwnProfile()
  const now = nowSeconds()
  const [shown, setShown] = useState<Code | null>(null)
  const [options, setOptions] = useState(false)
  const [kind, setKind] = useState<"group" | "personal">("group")
  const [label, setLabel] = useState("")
  const [days, setDays] = useState<number>(PERSONAL_DAYS)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [person, setPerson] = useState(false)
  // The first link of this opening is made once, also where the effect runs twice (StrictMode).
  const madeOnOpen = useRef(false)

  const manager = isManager(view.me.role)
  const standing = standingGroupInvite(state, view.me.pubkey, view.tokens, now)
  const code = shown ?? existing ?? standing
  const record: ClubInvite | undefined = code ? state.invites[code.invite] : undefined

  const make = async (what: "group" | "personal", validity: number) => {
    setBusy(true)
    setProblem(null)
    try {
      const next = nextDate(view, nowSeconds())
      const hostName = own?.name ?? undefined
      const result = await createInvite(
        state,
        {
          kind: what,
          days: validity,
          ...(what === "personal" && label.trim() ? { label } : {}),
          ...(hostName ? { hostName } : {}),
          ...(next ? { next: { title: next.title, starts: next.starts, ...(next.place ? { place: next.place } : {}) } } : {}),
        },
        await clubAuthor(),
      )
      setShown({ invite: result.invite, token: result.token })
      setOptions(false)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  // Opening the sheet: the standing link, or the first one is made right away.
  useEffect(() => {
    if (!open) {
      madeOnOpen.current = false
      setShown(null)
      setOptions(false)
      setKind("group")
      setLabel("")
      setDays(PERSONAL_DAYS)
      setProblem(null)
      setPerson(false)
      return
    }
    if (!code && !madeOnOpen.current && !state.info.archived) {
      madeOnOpen.current = true
      void make("group", GROUP_DAYS)
    }
    // Once per opening; the sheet never makes a second link by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reset = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const author = await clubAuthor()
      for (const invite of openGroupInvites(state, view.me.pubkey, nowSeconds())) await revokeInvite(state, invite.id, author)
    } catch (error) {
      setProblem(describe(error))
      setBusy(false)
      return
    }
    setBusy(false)
    await make("group", GROUP_DAYS)
  }

  const link = code ? clubLink(SITE.url, { club: view.id, invite: { id: code.invite, token: code.token }, relays: view.relays }) : null
  const name = view.info?.name ?? ""
  const until = record ? formatDate(t, record.expires * 1000) : null
  const line =
    record && until
      ? record.kind === "group"
        ? record.maker === "member"
          ? tx.invites.memberLine(until)
          : tx.invites.groupLine(until)
        : record.label
          ? tx.invites.personalNamed(record.label, until)
          : tx.invites.personalLine(until)
      : null
  const choosing = kind === "personal" && (!record || record.kind !== "personal")
  // The short code of the link shown, where this device knows it (made here or shared).
  const shortCode = code && record?.kind === "group" ? (view.codes[code.invite] ?? null) : null

  return (
    <>
    <Sheet open={open && !person} onOpenChange={onOpenChange} title={tx.invites.title} description={xshort ? undefined : tx.invites.description}>
      <SheetBody>
        {link ? (
          <SheetCode
            value={link}
            label={tx.invites.title}
            caption={line ?? tx.invites.caption}
            description={line ?? undefined}
            share={{ url: link, title: tx.invites.shareTitle(name), ...(shortCode ? { text: tx.invites.shareText(name, formatInviteCode(shortCode)) } : {}) }}
          >
            {shortCode && <CodeLine code={shortCode} />}
          </SheetCode>
        ) : problem ? null : (
          <div className="flex flex-col items-center">
            <div role="status" aria-live="polite" className="flex aspect-square w-full max-w-[min(18rem,32dvh)] items-center justify-center rounded-3xl border border-border bg-card p-6 text-center text-[0.9375rem] text-muted-foreground">
              {tx.invites.preparing}
            </div>
          </div>
        )}
        {problem && (
          <>
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
            <Button variant="secondary" disabled={busy} onClick={() => void make(kind, days)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
              {tx.retry}
            </Button>
          </>
        )}

        {!state.info.archived && !existing && (
          <>
            <Button variant="secondary" onClick={() => setPerson(true)} disabled={busy} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold text-primary">
              <UserRoundPlus className="mr-2 h-5 w-5" aria-hidden="true" />
              {tx.invites.toPerson}
            </Button>
            <button
              type="button"
              onClick={() => setOptions((o) => !o)}
              aria-expanded={options}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl text-[1.0625rem] text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
            >
              {tx.invites.options}
              <ChevronDown className={cn("h-5 w-5 transition-transform", options && "rotate-180")} aria-hidden="true" />
            </button>
            {options && (
              <div className="mt-2 flex flex-col gap-3">
                <ChoiceList
                  label={tx.invites.kind}
                  options={[
                    { value: "group", title: tx.invites.group, subtitle: tx.invites.groupHint },
                    { value: "personal", title: tx.invites.personal, subtitle: tx.invites.personalHint },
                  ]}
                  value={kind}
                  onChange={(next) => {
                    setKind(next)
                    if (next === "group") setShown(null)
                  }}
                />
                {choosing && (
                  <>
                    {state.info.visibility === "closed" && (
                      <TextField label={tx.invites.label} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} autoCapitalize="words" className="mt-0" />
                    )}
                    <div className="rounded-2xl border border-border bg-card">
                      <ChoiceRow
                        title={tx.invites.validity}
                        options={VALIDITY_DAYS.map((d) => ({ value: d, label: d === 7 ? tx.invites.week : d === 30 ? tx.invites.month : tx.invites.year }))}
                        value={days}
                        onChange={setDays}
                      />
                    </div>
                    <Button onClick={() => void make("personal", days)} disabled={busy} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
                      {busy ? tx.invites.creating : tx.invites.newPersonal}
                    </Button>
                  </>
                )}
                {record?.kind === "group" && (
                  <Button variant="ghost" onClick={() => setResetting(true)} disabled={busy} className="h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
                    {tx.invites.reset}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.done}</SheetButton>
      <Confirm open={resetting} onOpenChange={setResetting} title={tx.invites.resetTitle} text={manager ? tx.invites.resetText : tx.invites.resetTextOwn} confirm={tx.invites.resetConfirm} destructive onConfirm={() => void reset()} />
    </Sheet>
    {person && <InvitePersonSheet view={view} state={state} open onOpenChange={(next) => !next && setPerson(false)} />}
    </>
  )
}

// The code to say aloud, under the QR code: four and four characters, spaced to read at arm's
// length, and one tap to copy it.
function CodeLine({ code }: { code: string }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const { copied, copy } = useCopied()
  const shown = formatInviteCode(code)
  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <p className="text-[0.8125rem] text-muted-foreground">{tx.invites.codeLabel}</p>
      <button
        type="button"
        onClick={() => void copy(shown)}
        aria-label={`${shown}. ${copied ? tx.invites.codeCopied : tx.invites.codeCopy}`}
        className="flex min-h-11 items-center gap-2 rounded-xl px-3 font-display text-[1.75rem] font-semibold tracking-[0.12em] text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary"
      >
        <span aria-hidden="true">{shown}</span>
        <Copy className="h-5 w-5 text-primary" aria-hidden="true" />
      </button>
      <p role="status" aria-live="polite" className="h-4 text-[0.8125rem] text-success">
        {copied ? tx.invites.codeCopied : ""}
      </p>
    </div>
  )
}

// "Club teilen", for a member of a public club who may not invite: the club's own link, which
// opens the club and lets the person ask to join.
export function ClubShareSheet({ view, open, onOpenChange }: { view: ClubView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const xshort = useMediaQuery(XSHORT)
  const link = clubLink(SITE.url, { club: view.id, relays: view.relays })
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.club.shareTitle} description={xshort ? undefined : tx.club.shareText}>
      <SheetBody>
        {open && <SheetCode value={link} label={tx.club.shareTitle} caption={tx.club.shareCaption} description={tx.club.shareText} share={{ url: link, title: view.info?.name ?? tx.club.shareTitle }} />}
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.done}</SheetButton>
    </Sheet>
  )
}
