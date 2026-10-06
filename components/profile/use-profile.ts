"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useMatchHistory } from "@/lib/leaderboard"
import type { NostrEvent } from "@/lib/nostr/types"
import { profilePlayers } from "@/lib/profile/claim"
import { gamesOf, type PlayedGame } from "@/lib/profile/history"
import { readMetadata } from "@/lib/profile/metadata"
import { lookupOwnEvents, OWN, ownEvents, ownLookup, subscribeOwnLookups, type OwnLookup } from "@/lib/profile/own-events"
import { cachedProfile, loadPublicProfile, type LoadStatus, type PublicProfile } from "@/lib/profile/public-profile"
import { useSession, type Session } from "@/lib/profile/session"
import { onStorageChange } from "@/lib/storage/db"
import { summarizePlayers } from "@/lib/storage/stats"
import type { PlayerRecord } from "@/lib/storage/players"

// The data the profile screens show, from this device first and relays second.

// The profile's own events, kept current with this tab's and other tabs' writes. null while read.
export function useOwnEvents(pubkey: string | null) {
  const [events, setEvents] = useState<Map<string, NostrEvent> | null>(null)
  useEffect(() => {
    if (!pubkey) return
    let latest = 0
    const load = () => {
      const run = ++latest
      void ownEvents(pubkey).then(
        (found) => run === latest && setEvents(found),
        () => run === latest && setEvents(new Map()),
      )
    }
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("objects")) load()
    })
    return () => {
      latest = -1
      stop()
    }
  }, [pubkey])
  return events
}

// Looked for on relays once per profile and page load: on a new device the profile's name,
// picture, relays and rounds arrive this way; on a known one, changes made elsewhere. The
// lookup's state says whether what this device shows was ever confirmed by a relay.
export function useOwnLookup(pubkey: string | null): OwnLookup | null {
  useEffect(() => {
    if (pubkey) void lookupOwnEvents(pubkey)
  }, [pubkey])
  return useSyncExternalStore(
    subscribeOwnLookups,
    () => (pubkey ? ownLookup(pubkey) : null),
    () => null,
  )
}

export interface OwnProfile {
  session: Session
  events: Map<string, NostrEvent> | null
  // Whether relays were asked for the events, and answered (lib/profile/own-events.ts).
  lookup: OwnLookup | null
  metadata: ReturnType<typeof readMetadata>
  // The profile's player on this device (the one it plays as in setup), if it has one.
  player: PlayerRecord | null
  // The name the profile shows: its public name, else the one it plays under here.
  name: string | null
  // This device's games and players.
  history: ReturnType<typeof useMatchHistory>
  // The statistics key of the profile's players here, and who counts as them
  // (lib/profile/claim.ts); key is null while the profile has no player here.
  key: string | null
  sameAs: Map<string, string>
}

const NOBODY = new Map<string, string>()

// The signed-in profile; null for a guest, undefined while the session is read.
export function useOwnProfile(): OwnProfile | null | undefined {
  const session = useSession()
  const pubkey = session?.pubkey ?? null
  const events = useOwnEvents(pubkey)
  const lookup = useOwnLookup(pubkey)
  const history = useMatchHistory()
  const me = useMemo(() => (pubkey && history.players ? profilePlayers(pubkey, history.players, history.all) : null), [pubkey, history.players, history.all])
  const metadata = useMemo(() => readMetadata(events?.get(OWN.metadata)), [events])
  if (session === undefined) return undefined
  if (session === null) return null
  return { session, events, lookup, metadata, player: me?.player ?? null, name: metadata.name ?? me?.player?.name ?? null, history, key: me?.key ?? null, sameAs: me?.sameAs ?? NOBODY }
}

// The profile's games on this device, newest first.
export function useProfileGames(own: OwnProfile | null | undefined): PlayedGame[] {
  const all = own?.history.all
  const key = own?.key
  const aliases = own?.history.aliases
  const sameAs = own?.sameAs
  return useMemo(() => (all && key ? gamesOf(all, key, { aliases, sameAs }) : []), [all, key, aliases, sameAs])
}

// Players of this device with games who belong to no profile yet: the ones someone can say
// "that's me" to (lib/profile/claim.ts). Most games first.
export function useClaimablePlayers() {
  const { all, players, aliases, loaded } = useMatchHistory()
  const candidates = useMemo(() => {
    const free = new Set((players ?? []).filter((p) => !p.pubkey).map((p) => p.id))
    return summarizePlayers(all, { aliases }).filter((s) => s.playerId !== null && free.has(s.playerId))
  }, [all, players, aliases])
  return { candidates, loaded }
}

// Another player's address (name@domain), once it points back to their key; null until then and
// when it doesn't (a failed check shows nothing, it is no error).
export function useVerifiedNip05(address: string | null, pubkey: string): string | null {
  const [verified, setVerified] = useState<string | null>(null)
  useEffect(() => {
    setVerified(null)
    if (!address) return
    let alive = true
    void import("@/lib/nostr/ext/nip05").then(async ({ nip05Label, verifyNip05 }) => {
      if ((await verifyNip05(address, pubkey)) && alive) setVerified(nip05Label(address))
    })
    return () => {
      alive = false
    }
  }, [address, pubkey])
  return verified
}

export interface PublicProfileState {
  profile: PublicProfile | null
  // null while the first load runs.
  status: LoadStatus | null
  reload: () => void
}

// Another player's public profile: the version kept on this device at once, then what relays say.
export function usePublicProfile(pubkey: string | null, hints: readonly string[] = []): PublicProfileState {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [status, setStatus] = useState<LoadStatus | null>(null)
  const [attempt, setAttempt] = useState(0)
  const hintKey = hints.join(",")
  useEffect(() => {
    if (!pubkey) return
    let alive = true
    setStatus(null)
    void cachedProfile(pubkey)
      .catch(() => null)
      .then((cached) => alive && cached && setProfile((current) => current ?? cached))
    void loadPublicProfile(pubkey, hintKey ? hintKey.split(",") : []).then(
      (result) => {
        if (!alive) return
        setProfile(result.profile)
        setStatus(result.status)
      },
      () => alive && setStatus("offline"),
    )
    return () => {
      alive = false
    }
  }, [pubkey, hintKey, attempt])
  return { profile: pubkey && profile?.pubkey === pubkey ? profile : null, status, reload: () => setAttempt((n) => n + 1) }
}
