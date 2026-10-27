"use client"

import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { shortKey } from "@/lib/nostr/pointers"
import { acceptRequest, declineRequest } from "@/lib/clubs/membership"
import type { ClubState, JoinRequest } from "@/lib/protocol/club-state"

// Requests waiting for a leader (PLAN.md: capacity and order are a leader's decision): each
// with the person and two buttons. Shown wherever a leader looks: Spieler and Club verwalten.
export function RequestList({ state }: { state: ClubState }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const requests = Object.values(state.requests).sort((a, b) => a.at - b.at)
  const inviter = (request: JoinRequest) => (request.invite ? state.invites[request.invite]?.by : undefined)
  const names = useProfileNames([...requests.map((r) => r.pubkey), ...requests.map(inviter).filter((p): p is string => !!p)])
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (requests.length === 0) return null

  const decide = async (pubkey: string, accept: boolean) => {
    const request = state.requests[pubkey]
    if (!request) return
    setBusy(pubkey)
    setProblem(null)
    try {
      const author = await clubAuthor()
      await (accept ? acceptRequest(state, request, author) : declineRequest(state, request, author))
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Group title={tx.members.requests}>
      {requests.map((request) => {
        const info = names(request.pubkey)
        return (
          <div key={request.pubkey} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar seed={request.pubkey} name={info.name ?? undefined} src={info.picture} size={40} />
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="block text-[1.0625rem] leading-snug">{info.name ?? tx.unnamed}</span>
                <span className="block text-[0.8125rem] leading-snug text-muted-foreground">
                  {[info.name ? null : tx.id(shortKey(request.pubkey)), request.check === "unverified" ? tx.members.unverified : null, inviter(request) ? tx.members.invitedBy(names(inviter(request) as string).name ?? tx.unnamed) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button onClick={() => void decide(request.pubkey, true)} disabled={busy !== null} className="h-11 rounded-xl text-[1.0625rem] font-semibold">
                {tx.members.accept}
              </Button>
              <Button variant="secondary" onClick={() => void decide(request.pubkey, false)} disabled={busy !== null} className="h-11 rounded-xl text-[1.0625rem] font-semibold">
                {tx.members.decline}
              </Button>
            </div>
          </div>
        )
      })}
      {problem && (
        <InlineStatus tone="error" className="m-3">
          {problem}
        </InlineStatus>
      )}
    </Group>
  )
}
