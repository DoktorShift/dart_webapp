"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDate } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { SheetButton, useChange } from "@/components/clubs/common"
import { Confirm } from "@/components/ui/confirm"
import { GameSummary } from "@/components/clubs/game-summary"
import { InviteSheet } from "@/components/clubs/invite-sheet"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { pictureProblem } from "@/components/profile/profile-fields"
import type { ClubView } from "@/lib/clubs/club"
import type { ClubGame } from "@/lib/clubs/games"
import { revokeInvite, updateInfo, type InfoChange } from "@/lib/clubs/membership"
import { decideResult } from "@/lib/clubs/seasons"
import type { NotCounted } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import type { ClubSeason, ClubState } from "@/lib/protocol/club-state"
import { safeImageUrl } from "@/lib/shell/avatar"

// The sheets of "Club verwalten": a result the leaders decide, the club's details, the
// invitations.

// A game of the season that does not count (yet), and why: what a leader decides on.
export interface Decision {
  game: ClubGame
  why: NotCounted
}

export function DecideSheet({ view, state, season, decision, open, onOpenChange }: { view: ClubView; state: ClubState; season: ClubSeason; decision: Decision | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const decide = async (count: boolean) => {
    if (!decision) return
    setBusy(true)
    setProblem(null)
    try {
      await decideResult(state, season, decision.game, count, await clubAuthor(), reason)
      onOpenChange(false)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.manage.decide.title} description={decision ? tx.manage.decide.text[decision.why] : undefined}>
      <SheetBody>
        {decision && <GameSummary game={decision.game} me={view.me.pubkey} />}
        <TextField label={tx.manage.decide.reason} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} className="mt-4" />
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => void decide(true)} disabled={busy} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
            {tx.manage.decide.count}
          </Button>
          <Button variant="secondary" onClick={() => void decide(false)} disabled={busy} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
            {tx.manage.decide.exclude}
          </Button>
        </div>
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.cancel}</SheetButton>
    </Sheet>
  )
}

// Name, description, picture address and, for the owner, who gets in. Only what changed is
// written.
export function EditSheet({ view, state, open, onOpenChange }: { view: ClubView; state: ClubState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const px = useAreaT(PROFILE_TEXTS)
  const describe = useChange()
  const info = state.info
  const [name, setName] = useState(info.name)
  const [about, setAbout] = useState(info.about ?? "")
  const [picture, setPicture] = useState(info.picture ?? "")
  const [visibility, setVisibility] = useState(info.visibility)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const owner = view.me.role === "owner"

  const change: InfoChange = {
    ...(name.trim() !== info.name ? { name: name.trim() } : {}),
    ...(about.trim() !== (info.about ?? "") ? { about: about.trim() } : {}),
    ...((safeImageUrl(picture) ?? null) !== (info.picture ?? null) ? { picture: safeImageUrl(picture) } : {}),
    ...(visibility !== info.visibility ? { visibility } : {}),
  }
  const ready = name.trim() !== "" && !pictureProblem(picture) && Object.keys(change).length > 0

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await updateInfo(state, change, await clubAuthor())
      onOpenChange(false)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.manage.details}>
      <SheetBody>
        <TextField label={tx.create.name} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className="mt-0" />
        <TextField label={tx.create.about} value={about} onChange={(event) => setAbout(event.target.value)} maxLength={500} />
        <TextField
          label={px.form.picture}
          value={picture}
          onChange={(event) => setPicture(event.target.value)}
          placeholder={px.form.picturePlaceholder}
          inputMode="url"
          hint={px.form.pictureHint}
          error={pictureProblem(picture) ? px.form.pictureInvalid : undefined}
        />
        {owner && (
          <section className="mt-6">
            <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.create.visibility}</p>
            <ChoiceList
              label={tx.create.visibility}
              options={[
                { value: "closed", title: tx.create.closed, subtitle: tx.create.closedHint },
                { value: "public", title: tx.create.public, subtitle: tx.create.publicHint },
              ]}
              value={visibility}
              onChange={setVisibility}
            />
            <p className="mt-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.manage.edit.visibilityHint}</p>
          </section>
        )}
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        <Button onClick={() => void save()} disabled={!ready || busy} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {busy ? tx.manage.edit.saving : tx.manage.edit.save}
        </Button>
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.cancel}</SheetButton>
    </Sheet>
  )
}

// The invitations that still admit: how they were used, until when, the code again for those
// made on this device, and "Beenden". Plus a new one.
export function InvitesSheet({ view, state, open, onOpenChange }: { view: ClubView; state: ClubState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const now = nowSeconds()
  const [showing, setShowing] = useState<{ invite: string; token: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const active = Object.values(state.invites)
    .filter((i) => !i.ended && i.expires > now && !(i.kind === "personal" && i.uses.length > 0))
    .sort((a, b) => b.at - a.at)

  const revoke = async (invite: string) => {
    setProblem(null)
    try {
      await revokeInvite(state, invite, await clubAuthor())
    } catch (error) {
      setProblem(describe(error))
    }
  }

  return (
    <>
      <Sheet open={open && !showing && !creating} onOpenChange={onOpenChange} title={tx.manage.invites}>
        <SheetBody>
          <Button onClick={() => setCreating(true)} disabled={state.info.archived} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {tx.invites.create}
          </Button>
          <Group title={tx.invites.active} className="mt-6">
            {active.length === 0 && <ListRow title={tx.invites.none} />}
            {active.map((invite) => {
              const token = view.tokens[invite.id]
              return (
                <div key={invite.id} className="px-4 py-3">
                  <p className="text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">
                    {invite.kind === "group" ? tx.invites.group : tx.invites.personal}
                    {invite.label && `: ${invite.label}`}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">
                    {tx.invites.uses(invite.uses.length)} · {tx.invites.until(formatDate(t, invite.expires * 1000))}
                    {!token && ` · ${tx.invites.elsewhere}`}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={!token} onClick={() => token && setShowing({ invite: invite.id, token })} className="h-11 rounded-xl text-[1.0625rem] font-semibold">
                      {tx.invites.show}
                    </Button>
                    <Button variant="ghost" onClick={() => setRevoking(invite.id)} className="h-11 rounded-xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
                      {tx.invites.revoke}
                    </Button>
                  </div>
                </div>
              )
            })}
          </Group>
          {problem && (
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
          )}
        </SheetBody>
        <SheetButton onClick={() => onOpenChange(false)}>{t.common.done}</SheetButton>
        <Confirm
          open={revoking !== null}
          onOpenChange={(next) => !next && setRevoking(null)}
          title={tx.invites.revokeTitle}
          text={tx.invites.revokeText}
          confirm={tx.invites.revokeConfirm}
          destructive
          onConfirm={() => {
            if (revoking) void revoke(revoking)
            setRevoking(null)
          }}
        />
      </Sheet>
      {(showing || creating) && <InviteSheet view={view} state={state} open onOpenChange={(next) => !next && (setShowing(null), setCreating(false))} existing={showing} />}
    </>
  )
}
