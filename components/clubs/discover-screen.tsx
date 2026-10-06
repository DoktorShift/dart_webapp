"use client"

import { useEffect, useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { fetchPublicClubs } from "@/lib/clubs/relays"
import { updateClub } from "@/lib/clubs/store"
import type { NostrEvent } from "@/lib/nostr/types"
import { parseRecord } from "@/lib/protocol/records"

interface Found {
  id: string
  name: string
  about?: string
  picture?: string
  event: NostrEvent
}

// Public clubs, as far as the usual relays know them: the foundings they still hold, newest
// first. Best effort and said so (decision 0001: no directory); closed clubs never appear.
export default function DiscoverScreen() {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const [status, setStatus] = useState<"loading" | "offline" | "done">("loading")
  const [clubs, setClubs] = useState<Found[]>([])

  useEffect(() => {
    let alive = true
    void fetchPublicClubs().then(
      ({ events, answered }) => {
        if (!alive) return
        const found: Found[] = []
        for (const event of events) {
          const parsed = parseRecord(event)
          if (parsed.status !== "ok" || parsed.record.type !== "club.found" || parsed.record.content.visibility !== "public") continue
          const { name, about, picture } = parsed.record.content
          found.push({ id: event.id, name, about, picture, event })
        }
        setClubs(found)
        setStatus(answered ? "done" : "offline")
      },
      () => alive && setStatus("offline"),
    )
    return () => {
      alive = false
    }
  }, [])

  const open = async (club: Found) => {
    await updateClub(club.id, { events: [club.event] })
    nav.push(CLUB_SCREENS.view, { club: club.id, name: club.name })
  }

  return (
    <div className="pb-4">
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{tx.discover.intro}</p>
      {status === "loading" && <p className="mt-6 px-4 text-[0.9375rem] text-muted-foreground">{tx.discover.loading}</p>}
      {status === "offline" && (
        <InlineStatus tone="info" className="mt-6">
          {tx.discover.offline}
        </InlineStatus>
      )}
      {status === "done" && clubs.length === 0 && (
        <InlineStatus tone="info" className="mt-6">
          {tx.discover.none}
        </InlineStatus>
      )}
      {clubs.length > 0 && (
        <Group>
          {clubs.map((club) => (
            <ListRow
              key={club.id}
              title={
                <span className="flex items-center gap-3">
                  <Avatar seed={club.id} name={club.name} src={club.picture} size={36} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{club.name}</span>
                </span>
              }
              subtitle={club.about}
              onClick={() => void open(club)}
            />
          ))}
        </Group>
      )}
    </div>
  )
}
