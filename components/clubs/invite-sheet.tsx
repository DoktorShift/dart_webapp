"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { ChoiceRow } from "@/components/ui/group"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { QRCodeView } from "@/components/common/qr-code-view"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetBody, SheetButton, useChange } from "@/components/clubs/common"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useOwnProfile } from "@/components/profile/use-profile"
import { nextDate, type ClubView } from "@/lib/clubs/club"
import { clubLink } from "@/lib/clubs/links"
import { createInvite } from "@/lib/clubs/membership"
import { SITE } from "@/lib/site"
import { nowSeconds } from "@/lib/nostr/time"
import type { ClubState } from "@/lib/protocol/club-state"

const VALIDITY_DAYS = [1, 7, 30]

// "Mitglieder einladen": a group link (everyone with it joins) or a personal invitation (one
// person, confirmed by a leader), then the QR code and the link to share. The link's secret
// stays on this device: a leader whose invitation was made elsewhere makes their own.
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
  // Show the code of an invitation made here, instead of making a new one.
  existing?: { invite: string; token: string } | null
}) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  // The host's name in the preview: as this profile is called here, known at once.
  const own = useOwnProfile()
  const [kind, setKind] = useState<"group" | "personal">("group")
  const [label, setLabel] = useState("")
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<{ invite: string; token: string } | null>(null)
  const code = made ?? existing ?? null

  const create = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const next = nextDate(view, nowSeconds())
      const hostName = own?.name ?? undefined
      const result = await createInvite(
        state,
        { kind, days, ...(kind === "personal" && label.trim() ? { label } : {}), ...(hostName ? { hostName } : {}), ...(next ? { next: { title: next.title, starts: next.starts, ...(next.place ? { place: next.place } : {}) } } : {}) },
        await clubAuthor(),
      )
      setMade({ invite: result.invite, token: result.token })
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  const link = code ? clubLink(SITE.url, { club: view.id, invite: { id: code.invite, token: code.token }, relays: view.relays }) : null
  const name = view.info?.name ?? ""

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.invites.title} description={link ? undefined : tx.invites.description}>
      <SheetBody>
        {link ? (
          <QRCodeView value={link} caption={tx.invites.caption} label={tx.invites.title} share={{ url: link, title: tx.invites.shareTitle(name) }} />
        ) : (
          <>
            <ChoiceList
              label={tx.invites.kind}
              options={[
                { value: "group", title: tx.invites.group, subtitle: tx.invites.groupHint },
                { value: "personal", title: tx.invites.personal, subtitle: tx.invites.personalHint },
              ]}
              value={kind}
              onChange={setKind}
            />
            {kind === "personal" && state.info.visibility === "closed" && (
              <TextField label={tx.invites.label} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} autoCapitalize="words" className="mt-4" />
            )}
            <div className="mt-4 rounded-2xl border border-border bg-card">
              <ChoiceRow title={tx.invites.validity} options={VALIDITY_DAYS.map((d) => ({ value: d, label: tx.invites.days(d) }))} value={days} onChange={setDays} />
            </div>
            {problem && (
              <InlineStatus tone="error" className="mt-4">
                {problem}
              </InlineStatus>
            )}
            <Button onClick={() => void create()} disabled={busy} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
              {busy ? tx.invites.creating : tx.invites.create}
            </Button>
          </>
        )}
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{link ? t.common.done : t.common.cancel}</SheetButton>
    </Sheet>
  )
}
