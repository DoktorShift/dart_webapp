import type { ClubRole } from "../protocol/club.ts"
import type { ClubState, JoinRequest } from "../protocol/club-state.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { inviteKey, inviteProof, newInviteToken, previewKey } from "../protocol/invite.ts"
import { buildRecord, maxSharedKeys, type ContentOf, type RecordType } from "../protocol/records.ts"
import { readLabels } from "../protocol/tags.ts"
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
  return { template, seal: { readers: [...Object.keys(state.members), ...about] } }
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
// without one. Dated after the invite, which the reducer requires.
export async function joinClub(club: string, invite: { id: string; token: string; at: number } | null, author: Author): Promise<Sent> {
  const content = invite ? { invite: invite.id, proof: inviteProof(invite.token, author.pubkey) } : {}
  const template = buildRecord("club.join", content, { created_at: recordTime(invite?.at ?? 0), root: club })
  const sent = await send(club, [{ template }], author)
  await updateClub(club, { invite: null })
  return sent
}

// Leaves the club, or withdraws a waiting request. Always in the clear (club.md).
export const leaveClub = (club: string, basedOn: number, author: Author) =>
  send(club, [{ template: buildRecord("club.leave", {}, { created_at: recordTime(basedOn), root: club }) }], author)

// ---- Requests, roles, removal ------------------------------------------------------------------

export const acceptRequest = (state: ClubState, request: JoinRequest, author: Author) =>
  send(state.id, [record(state, "club.accept", { request: request.event, member: request.pubkey }, [request.pubkey])], author)

export const declineRequest = (state: ClubState, request: JoinRequest, author: Author) =>
  send(state.id, [record(state, "club.decline", { request: request.event }, [request.pubkey])], author)

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

// Offered only to members a leader confirmed (club.md, "Übergabe des Eigentums"): someone a
// reader may still see as a request would make the hand-over depend on records nobody pins.
export const mayReceiveOwnership = (state: ClubState, pubkey: string) => {
  const member = state.members[pubkey]
  return member !== undefined && member.role !== "owner" && member.via !== "group"
}

export function offerOwnership(state: ClubState, to: string, author: Author) {
  const at = afterState(state)
  const content = { to, prev: state.heads.owner, expires: at + OFFER_SECONDS, info: state.heads.info, member: state.members[to].head }
  const template = buildRecord("club.owner.offer", content, { created_at: at, root: state.id })
  return send(state.id, [state.info.visibility === "closed" ? { template, seal: { readers: Object.keys(state.members) } } : { template }], author)
}

export const cancelOffer = (state: ClubState, author: Author) =>
  send(state.id, [record(state, "club.owner.cancel", { offer: state.offer!.event })], author)

export const acceptOwnership = (state: ClubState, author: Author) =>
  send(
    state.id,
    [record(state, "club.owner.accept", { offer: state.offer!.event, info: state.heads.info, member: state.members[author.pubkey].head })],
    author,
  )

// ---- Upkeep by leaders' devices ----------------------------------------------------------------

// Members of a closed club who joined after the last key share read nothing written before
// them until a leader shares the content keys (club.md, "Neue Mitglieder").
export const needsAccess = (state: ClubState, me: string) =>
  state.info.visibility === "closed" && Object.values(state.members).some((m) => m.pubkey !== me && !state.shares.some((s) => s.at >= m.since))

export const needsCapacity = (state: ClubState) =>
  state.info.visibility === "closed" && state.info.capacity === undefined && Object.keys(state.members).length >= CAPACITY_AT

// Shares the content keys of the club's sealed records with the current members, in as many
// club.keys records as the key budget per event needs (records.ts maxSharedKeys).
export function shareAccess(state: ClubState, events: readonly NostrEvent[], keys: Readonly<Record<string, string>>, author: Author): Promise<Sent> {
  const readers = Object.keys(state.members)
  const shareable = events.filter((e) => keys[e.id] && readLabels(e.tags)?.type !== "club.keys").map((e): [string, string] => [e.id, keys[e.id]])
  const per = maxSharedKeys(readers.length)
  // Dated after every member's join (afterState): the share counts as theirs (needsAccess).
  const items: Outgoing[] = []
  for (let i = 0; i < shareable.length; i += per) items.push(record(state, "club.keys", { keys: shareable.slice(i, i + per) }))
  return send(state.id, items, author)
}

export const limitMembers = (state: ClubState, author: Author) => updateInfo(state, { capacity: CLOSED_CAPACITY }, author)
