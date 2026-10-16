import type { ClubRole } from "../protocol/club.ts"
import type { ClubState, JoinRequest } from "../protocol/club-state.ts"
import { clubRoleAt } from "../protocol/club-state.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { inviteKey, inviteProof, newInviteToken, previewKey } from "../protocol/invite.ts"
import { buildRecord, maxSharedKeys, type ContentOf, type RecordType } from "../protocol/records.ts"
import { parseEnvelope, wrapsFor } from "../protocol/seal.ts"
import { encryptionOf, readLabels, tagValue } from "../protocol/tags.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { afterState, recordTime, send, type Author, type Outgoing, type Sent } from "./send.ts"
import { updateClub } from "./store.ts"

// What members and leaders do in a club (docs/protocol/families/club.md, permissions.md):
// founding, invitations, joining and leaving, requests, roles, removal, the hand-over of
// ownership, the club's details, and sharing access to earlier records in a closed club. Each
// function writes the records; the reducer decides what they mean. In a closed club every
// record but a join and a leave is sealed for the current members as the author sees them,
// plus whoever the record is about (an accepted or removed person, so their app shows it).

const DAY = 24 * 60 * 60
// Ownership offers are open for a day (conflicts.md, "Grenzen ohne vertrauenswürdige Zeit" 1).
const OFFER_SECONDS = DAY
// A closed club without its own limit gets one at about 90 members, so joins near the 100 a
// sealed record can carry are decided by a leader, not by timestamps (club.md, "Ausnahme").
const CAPACITY_AT = 90
const CLOSED_CAPACITY = 100

function record<T extends RecordType>(state: ClubState, type: T, content: ContentOf<T>, about: string[] = []): Outgoing {
  const template = buildRecord(type, content, { created_at: afterState(state), root: state.id })
  if (state.info.visibility !== "closed" || type === "club.join" || type === "club.leave") return { template }
  return { template, seal: { readers: [...new Set([...Object.keys(state.members), ...about])] } }
}

// The club's records this device has not loaded or could not open make a change built on them
// meaningless for every other reader: the person refreshes first.
export class ClubOutdatedError extends Error {
  constructor() {
    super("the club's copy on this device is behind what the change builds on")
    this.name = "ClubOutdatedError"
  }
}

// ---- Founding and details ----------------------------------------------------------------------

export interface FoundingInput {
  name: string
  about?: string
  visibility: "closed" | "public"
}

// Founds a club; its id is the founding's event id. A closed club is sealed from the start, for
// its only member so far.
export async function foundClub(input: FoundingInput, author: Author): Promise<string> {
  const content = { name: input.name.trim(), ...(input.about?.trim() ? { about: input.about.trim() } : {}), visibility: input.visibility }
  const template = buildRecord("club.found", content, { created_at: recordTime() })
  const sent = await send(null, [input.visibility === "closed" ? { template, seal: { readers: [author.pubkey] } } : { template }], author)
  return sent.events[0].id
}

export type InfoChange = Partial<Pick<ContentOf<"club.update">, "name" | "about" | "picture" | "visibility" | "capacity" | "archived">>

export const updateInfo = (state: ClubState, change: InfoChange, author: Author): Promise<Sent> =>
  send(state.id, [record(state, "club.update", { prev: state.heads.info, ...change })], author)

// ---- Invitations -------------------------------------------------------------------------------

export interface InviteInput {
  kind: "group" | "personal"
  days: number
  // Who it is for ("Für Tom"); only in a closed club, where it travels sealed.
  label?: string
  // What the link shows before joining (closed clubs): the host's name and the next date.
  hostName?: string
  next?: InvitePreview["next"]
}

export async function createInvite(state: ClubState, input: InviteInput, author: Author): Promise<{ invite: string; token: string; sent: Sent }> {
  // A token whose derived key falls outside the curve (chance about 2^-128) is drawn again.
  let token = newInviteToken()
  let key: string | null = null
  while (key === null) {
    try {
      key = inviteKey(token)
    } catch {
      token = newInviteToken()
    }
  }
  const expires = afterState(state) + input.days * DAY
  const closed = state.info.visibility === "closed"
  const label = closed && input.label?.trim() ? { label: input.label.trim().slice(0, 60) } : {}
  const item = record(state, "club.invite", { kind: input.kind, key, expires, ...label })
  if (closed && item.seal) {
    const i = state.info
    item.seal.preview = {
      key: previewKey(token),
      content: {
        name: i.name,
        ...(i.about ? { about: i.about } : {}),
        ...(i.picture ? { picture: i.picture } : {}),
        host: author.pubkey,
        ...(input.hostName?.trim() ? { hostName: input.hostName.trim().slice(0, 60) } : {}),
        kind: input.kind,
        expires,
        // With a member limit a group link only asks (club-state.ts join): the preview says so
        // before the person reads any record.
        ...(i.capacity !== undefined ? { limited: true } : {}),
        ...(input.next ? { next: input.next } : {}),
      },
    }
  }
  const sent = await send(state.id, [item], author)
  const invite = sent.events[0].id
  await updateClub(state.id, { token: { invite, token } })
  return { invite, token, sent }
}

export const revokeInvite = (state: ClubState, invite: string, author: Author) =>
  send(state.id, [record(state, "club.invite.revoke", { invite })], author)

// Joins with an invite link (proof of its token, bound to this profile), or asks to join
// without one. Dated after the invite, which the reducer requires. The opened invitation stays
// with the club: in a closed club its preview is all the joiner can read until a leader shares
// access.
export function joinClub(club: string, invite: { id: string; token: string; at: number } | null, author: Author): Promise<Sent> {
  const content = invite ? { invite: invite.id, proof: inviteProof(invite.token, author.pubkey) } : {}
  const template = buildRecord("club.join", content, { created_at: recordTime(invite?.at ?? 0), root: club })
  return send(club, [{ template }], author)
}

// Leaves the club, or withdraws a waiting request. Always in the clear (club.md).
export const leaveClub = (club: string, basedOn: number, author: Author) =>
  send(club, [{ template: buildRecord("club.leave", {}, { created_at: recordTime(basedOn), root: club }) }], author)

// ---- Requests, roles, removal ------------------------------------------------------------------

export const acceptRequest = (state: ClubState, request: JoinRequest, author: Author) =>
  send(state.id, [record(state, "club.accept", { request: request.event, member: request.pubkey }, [request.pubkey])], author)

// A declined person is no reader: in a closed club they could not open the founding anyway.
export const declineRequest = (state: ClubState, request: JoinRequest, author: Author) =>
  send(state.id, [record(state, "club.decline", { request: request.event })], author)

// Ending an admin's role names the last club change its author saw (conflicts.md, "Ende einer
// Befugnis").
const tenure = (state: ClubState, member: string) => (state.members[member]?.role === "admin" ? { info: state.heads.info } : {})

export const setRole = (state: ClubState, member: string, role: Exclude<ClubRole, "owner">, author: Author) =>
  send(state.id, [record(state, "club.role", { member, role, prev: state.members[member].head, ...tenure(state, member) })], author)

export const removeMember = (state: ClubState, member: string, author: Author, reason?: string) =>
  send(
    state.id,
    [record(state, "club.remove", { member, prev: state.members[member].head, ...(reason?.trim() ? { reason: reason.trim() } : {}), ...tenure(state, member) }, [member])],
    author,
  )

// ---- Ownership ---------------------------------------------------------------------------------

// The offer that still admits an acceptance; the reducer keeps a lapsed one until it is
// withdrawn or replaced.
export const openOffer = (state: ClubState, now: number) => (state.offer && state.offer.expires > now ? state.offer : null)

// Whether an owner or admin confirmed this membership: accepted, or a group link joiner whose
// join a manager's role record names as its base since (club-state.ts `pending`: that record
// is the confirmation for every reader).
export const isConfirmedMember = (state: ClubState, pubkey: string) => {
  const member = state.members[pubkey]
  return member !== undefined && (member.via !== "group" || state.log.applied.some((a) => a.id === member.head && a.type === "club.role"))
}

const isApplied = (state: ClubState, id: string) => id === state.id || state.log.applied.some((a) => a.id === id)

// Ownership goes only to a confirmed member (club.md, "Übergabe des Eigentums"): someone a
// reader may still see as a request would make the hand-over depend on records nobody pins
// (conflicts.md Ü6 d). A group link joiner no leader confirmed yet is confirmed first, with a
// role record that names their join and keeps their role.
export async function offerOwnership(state: ClubState, to: string, author: Author): Promise<Sent> {
  const member = state.members[to]
  if (!member || member.role === "owner") throw new Error("ownership goes to another member")
  let base = { head: member.head, at: 0 }
  if (!isConfirmedMember(state, to)) {
    const confirmed = await setRole(state, to, member.role, author)
    base = { head: confirmed.events[0].id, at: confirmed.events[0].created_at }
  }
  const at = afterState(state, base.at)
  const content = { to, prev: state.heads.owner, expires: at + OFFER_SECONDS, info: state.heads.info, member: base.head }
  const template = buildRecord("club.owner.offer", content, { created_at: at, root: state.id })
  return send(state.id, [state.info.visibility === "closed" ? { template, seal: { readers: Object.keys(state.members) } } : { template }], author)
}

export const cancelOffer = (state: ClubState, author: Author) =>
  send(state.id, [record(state, "club.owner.cancel", { offer: state.offer!.event })], author)

// Accepted only on a device that holds what the offer hands over (club.md, "Übergabe"): an
// acceptance naming details or a membership the device never applied would be invalid for
// every other reader while this one shows success.
export function acceptOwnership(state: ClubState, author: Author): Promise<Sent> {
  const offer = openOffer(state, nowSeconds())
  if (!offer || !isApplied(state, offer.info) || !isApplied(state, offer.member)) throw new ClubOutdatedError()
  return send(state.id, [record(state, "club.owner.accept", { offer: offer.event, info: state.heads.info, member: state.members[author.pubkey].head })], author)
}

// ---- Upkeep by leaders' devices ----------------------------------------------------------------

// Members of a closed club who read nothing written before they joined: no key share dated
// since their join is wrapped for them (club.md, "Neue Mitglieder"). Told from the envelopes
// of the shares managers wrote, whoever can open them: a share is sealed for the members it
// is for, so another manager's device can't read it, but every envelope says whom it is
// wrapped for (seal.ts wrapsFor).
export function waitingAccess(state: ClubState, events: readonly NostrEvent[], me: string): string[] {
  if (state.info.visibility !== "closed") return []
  const shares = events
    .filter((e) => readLabels(e.tags)?.type === "club.keys" && tagValue(e.tags, "e") === state.id && isManagerAt(state, e.pubkey, e.created_at) && encryptionOf(e.tags).form === "seal")
    .map((e) => ({ at: e.created_at, envelope: envelopeOf(e) }))
  const covered = (member: ClubState["members"][string]) => shares.some((s) => s.at >= member.since && s.envelope !== null && wrapsFor(s.envelope, member.pubkey).length > 0)
  return Object.values(state.members)
    .filter((m) => m.pubkey !== me && !covered(m))
    .map((m) => m.pubkey)
}

const isManagerAt = (state: ClubState, pubkey: string, at: number) => {
  const role = clubRoleAt(state, pubkey, at)
  return role === "owner" || role === "admin"
}

// A damaged envelope covers nobody.
function envelopeOf(event: NostrEvent) {
  try {
    return parseEnvelope(event.content)
  } catch {
    return null
  }
}

export const needsCapacity = (state: ClubState) =>
  state.info.visibility === "closed" && state.info.capacity === undefined && Object.keys(state.members).length >= CAPACITY_AT

// Shares the content keys of every sealed record this device can read with `readers`, in as
// many club.keys records as the key budget per event needs (records.ts maxSharedKeys). Sealed
// for those readers only: each wrap is one encryption by the signer.
export function shareAccess(state: ClubState, events: readonly NostrEvent[], keys: Readonly<Record<string, string>>, author: Author, readers: readonly string[]): Promise<Sent> {
  const shareable = events.filter((e) => keys[e.id] && readLabels(e.tags)?.type !== "club.keys").map((e): [string, string] => [e.id, keys[e.id]])
  if (readers.length === 0 || shareable.length === 0) return Promise.resolve({ events: [], published: true })
  const per = maxSharedKeys(readers.length)
  // Dated after every member's join (afterState): the share counts for them (waitingAccess).
  const items: Outgoing[] = []
  for (let i = 0; i < shareable.length; i += per) {
    items.push({ template: buildRecord("club.keys", { keys: shareable.slice(i, i + per) }, { created_at: afterState(state), root: state.id }), seal: { readers } })
  }
  return send(state.id, items, author)
}

export const limitMembers = (state: ClubState, author: Author) => updateInfo(state, { capacity: CLOSED_CAPACITY }, author)
