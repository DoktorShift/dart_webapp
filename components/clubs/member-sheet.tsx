"use client"

import { useState } from "react"
import { User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { Confirm, useChange } from "@/components/clubs/common"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useNames } from "@/components/clubs/use-names"
import type { ClubView } from "@/lib/clubs/club"
import { mayReceiveOwnership, offerOwnership, removeMember, setRole } from "@/lib/clubs/membership"
import type { Author } from "@/lib/clubs/send"
import type { ClubRole } from "@/lib/protocol/club"
import type { ClubState } from "@/lib/protocol/club-state"
import { SCREENS } from "@/lib/shell/registry"

type GivenRole = Exclude<ClubRole, "owner">

// A member, for a leader: their profile, their role, the hand-over of the club (owner), and
// removal with a confirmation. What a leader may do follows docs/protocol/permissions.md.
export function MemberSheet({ view, state, member, open, onOpenChange }: { view: ClubView; state: ClubState; member: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const describe = useChange()
  const names = useNames(member ? [member] : [])
  const [reason, setReason] = useState("")
  const [removing, setRemoving] = useState(false)
  const [offering, setOffering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const current = member ? state.members[member] : undefined
  const name = member ? (names(member).name ?? tx.unnamed) : ""
  const myRole = view.me.role
  const mine = member === view.me.pubkey
  const canRole = !!current && !mine && (myRole === "owner" ? current.role !== "owner" : myRole === "admin" && current.role !== "admin" && current.role !== "owner")
  const roles: GivenRole[] = myRole === "owner" ? ["admin", "director", "member"] : ["director", "member"]
  const canOffer = !!member && myRole === "owner" && !state.offer && mayReceiveOwnership(state, member)
  // The owner could hand over, but this member came in through a group link and no leader
  // confirmed them (lib/clubs/membership.ts mayReceiveOwnership): say why there is no button.
  const unofferable = !!member && myRole === "owner" && !state.offer && !mine && !mayReceiveOwnership(state, member)

  const run = async (action: (author: Author) => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action(await clubAuthor())
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setReason("")
      setProblem(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={close} title={name} description={current ? tx.roles[current.role] : undefined}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        <Group className="mt-0 first:mt-0">
          <ListRow
            icon={User}
            iconTone="blue"
            title={t.shell.screens.publicProfile}
            onClick={() => {
              close(false)
              if (member) nav.push(SCREENS.profilePublic, { pubkey: member })
            }}
          />
        </Group>
        {canRole && current && (
          <section className="mt-6">
            <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.members.role}</p>
            <ChoiceList
              label={tx.members.role}
              options={roles.map((role) => ({ value: role, title: tx.roles[role], subtitle: tx.members.roleHint[role] }))}
              value={current.role === "owner" ? null : current.role}
              onChange={(role) => {
                if (!busy && role !== current.role && member) void run((author) => setRole(state, member, role, author))
              }}
            />
          </section>
        )}
        {canOffer && (
          <Button variant="secondary" onClick={() => setOffering(true)} disabled={busy} className="mt-6 h-12 w-full rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15">
            {tx.members.offer}
          </Button>
        )}
        {unofferable && <p className="mt-6 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{tx.members.noCandidates}</p>}
        {canRole && (
          <>
            <TextField label={tx.members.reason} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} />
            <Button variant="ghost" onClick={() => setRemoving(true)} disabled={busy} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
              {tx.members.remove}
            </Button>
          </>
        )}
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
      </div>
      <Button variant="ghost" onClick={() => close(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {t.common.done}
      </Button>
      {member && (
        <>
          <Confirm
            open={removing}
            onOpenChange={setRemoving}
            title={tx.members.removeTitle(name)}
            text={tx.members.removeText}
            confirm={tx.members.removeConfirm}
            destructive
            onConfirm={() => void run((author) => removeMember(state, member, author, reason)).then(() => close(false))}
          />
          <Confirm
            open={offering}
            onOpenChange={setOffering}
            title={tx.members.offerTitle(name)}
            text={tx.members.offerText}
            confirm={tx.members.offerConfirm}
            onConfirm={() => void run((author) => offerOwnership(state, member, author)).then(() => close(false))}
          />
        </>
      )}
    </Sheet>
  )
}
