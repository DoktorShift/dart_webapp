import type { EventTemplate } from "../nostr/types.ts"
import type { RecordSpec } from "./common.ts"
import { MODE_ID, shortText } from "./common.ts"
import { FORMAT_VERSION, KIND_BADGE_AWARD, KIND_BADGE_DEFINITION, KIND_PROFILE_BADGES, KIND_RECORD, LABEL_NAMESPACE, MAX_EVENT_BYTES } from "./kinds.ts"
import type { Reason } from "./reasons.ts"
import { ProtocolError } from "./reasons.ts"
import { int, obj, opt, refine, str, time, utf8Length } from "./schema.ts"
import type { SignedEvent } from "./tags.ts"
import { byReplayOrder, HEX64, oversizedTag, readLabels, signedEventBytes, tagValue, tagValues } from "./tags.ts"

// Awards (docs/protocol/families/badges.md) in plain NIP-58: definition kind 30009 and award
// kind 8 by the same issuer, the profile's choice in kind 10008. BlueLine adds labels, the
// scope of the badge and two tags on the award: the evidence ("e": the result or decision it
// rests on) and the occasion ("occasion"), so the same badge for the same occasion counts
// once however often it is delivered or re-signed. Issuers are the club or tournament
// organizer, or — marked "Selbst erreicht" — the player for their own milestone. There is no
// BlueLine issuer key (docs/decisions/0001, F3). Where no other record is the evidence (a
// milestone in the player's own game, a recognition), the issuer writes one: badge.evidence.

export const BADGE_SCOPES = ["self", "club", "tournament", "recognition"] as const
export type BadgeScope = (typeof BADGE_SCOPES)[number]

export interface BadgeDefinitionInput {
  badge: string
  version: number
  scope: BadgeScope
  // Club or tournament id for those scopes.
  scopeId?: string
  name: string
  description: string
  image?: string
  thumb?: string
}

const BADGE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
// An occasion is the id of what the badge is for (a tournament, a season, a match result), or
// "once" for a badge a person gets at most once.
const OCCASION = /^([0-9a-f]{64}|[0-9a-f]{32}|once)$/
const HTTPS = /^https:\/\/[^\s"<>\\]+$/

export const badgeD = (b: Pick<BadgeDefinitionInput, "badge" | "version" | "scope" | "scopeId">) =>
  b.scopeId ? `blueline:${b.scope}:${b.scopeId}:${b.badge}:v${b.version}` : `blueline:${b.scope}:${b.badge}:v${b.version}`

const D_PATTERN = /^blueline:(self|club|tournament|recognition):(?:([0-9a-f]{64}):)?([a-z0-9][a-z0-9-]{0,47}):v([1-9][0-9]{0,3})$/

// What a badge rests on when no other record does (PLAN.md "Auszeichnungsnachweis": versioned
// condition, concrete result, issuer = author): the player's own game for a milestone shown as
// "Selbst erreicht", or the issuer's words for a recognition. Public and minimal: the game's id
// on the player's devices, when it ended, its mode and the figure that met the condition, never
// opponents or other games. The award names it in its "e" tag.
const evidence = refine(
  obj({
    badge: str({ max: 200, pattern: D_PATTERN, description: "d of the badge definition: the versioned condition" }),
    result: opt(
      obj({
        game: str({ min: 1, max: 64, pattern: /^[A-Za-z0-9-]+$/, description: "The game's id on the player's devices" }),
        finishedAt: time(),
        mode: str({ min: 1, max: 16, pattern: MODE_ID, description: "Game mode id" }),
        value: int(0, 1_000_000_000, "The figure that met the condition, in the badge's unit (docs/protocol/families/badges.md)"),
      }),
    ),
    note: opt(shortText()),
  }),
  (v) => (v.result || v.note ? null : "names a result or a note"),
)

export const BADGE_TYPES = {
  "badge.evidence": { kind: KIND_RECORD, root: "self", encryption: "none", schema: evidence, description: "What a self-earned milestone or a recognition rests on" },
} satisfies Record<string, RecordSpec>

const labelTags = (type: string) => [
  ["L", LABEL_NAMESPACE],
  ["l", type, LABEL_NAMESPACE],
  ["v", FORMAT_VERSION],
]

export function badgeDefinitionTemplate(def: BadgeDefinitionInput, created_at: number): EventTemplate {
  if (!BADGE_ID.test(def.badge) || !Number.isInteger(def.version) || def.version < 1 || def.version > 9999) throw new ProtocolError("invalid_content", "badge id or version")
  const needsScopeId = def.scope === "club" || def.scope === "tournament"
  if (needsScopeId !== (def.scopeId !== undefined) || (def.scopeId !== undefined && !HEX64.test(def.scopeId))) throw new ProtocolError("invalid_content", "club and tournament badges name their club or tournament")
  if (!def.name.trim() || utf8Length(def.name) > 80 || utf8Length(def.description) > 500) throw new ProtocolError("invalid_content", "name or description")
  for (const url of [def.image, def.thumb]) if (url !== undefined && !HTTPS.test(url)) throw new ProtocolError("invalid_content", "images are https URLs")
  const tags = [
    ["d", badgeD(def)],
    ["name", def.name],
    ["description", def.description],
    ...(def.image ? [["image", def.image]] : []),
    ...(def.thumb ? [["thumb", def.thumb]] : []),
    ...labelTags("badge.definition"),
    def.scopeId ? ["scope", def.scope, def.scopeId] : ["scope", def.scope],
  ]
  return { kind: KIND_BADGE_DEFINITION, created_at, tags, content: "" }
}

export function badgeAwardTemplate(input: { issuer: string; d: string; recipient: string; evidence: string; occasion: string }, created_at: number): EventTemplate {
  if (!HEX64.test(input.issuer) || !HEX64.test(input.recipient) || !HEX64.test(input.evidence)) throw new ProtocolError("invalid_content", "issuer, recipient or evidence")
  if (!D_PATTERN.test(input.d) || !OCCASION.test(input.occasion)) throw new ProtocolError("invalid_content", "badge or occasion")
  const template = {
    kind: KIND_BADGE_AWARD,
    created_at,
    tags: [["a", `${KIND_BADGE_DEFINITION}:${input.issuer}:${input.d}`], ["p", input.recipient], ["e", input.evidence], ["occasion", input.occasion], ...labelTags("badge.award")],
    content: "",
  }
  if (signedEventBytes(template) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", "award too large")
  return template
}

export interface BadgeDefinitionInfo {
  issuer: string
  d: string
  scope: BadgeScope
  scopeId?: string
  badge: string
  version: number
  name: string
  description: string
  image?: string
}

export function checkBadgeDefinition(def: SignedEvent): { ok: true; info: BadgeDefinitionInfo } | { ok: false; reason: Reason; detail: string } {
  if (def.kind !== KIND_BADGE_DEFINITION) return { ok: false, reason: "wrong_kind", detail: `kind ${def.kind}` }
  const labels = readLabels(def.tags)
  if (!labels || labels.type !== "badge.definition") return { ok: false, reason: "not_blueline", detail: "not a BlueLine badge" }
  if (labels.version !== FORMAT_VERSION) return { ok: false, reason: "unknown_version", detail: `version ${labels.version}` }
  if (oversizedTag(def.tags)) return { ok: false, reason: "tag_too_long", detail: "tag too long" }
  const d = tagValue(def.tags, "d") ?? ""
  const m = D_PATTERN.exec(d)
  const scopeTag = def.tags.find((t) => t[0] === "scope")
  if (!m || !scopeTag || scopeTag[1] !== m[1] || (scopeTag[2] ?? undefined) !== (m[2] ?? undefined)) return { ok: false, reason: "invalid_tags", detail: "d and scope disagree" }
  if ((m[1] === "club" || m[1] === "tournament") !== (m[2] !== undefined)) return { ok: false, reason: "invalid_tags", detail: "scope id" }
  const name = tagValue(def.tags, "name")
  if (!name) return { ok: false, reason: "invalid_tags", detail: "name missing" }
  const image = tagValue(def.tags, "image")
  return {
    ok: true,
    info: {
      issuer: def.pubkey,
      d,
      scope: m[1] as BadgeScope,
      ...(m[2] ? { scopeId: m[2] } : {}),
      badge: m[3],
      version: Number(m[4]),
      name,
      description: tagValue(def.tags, "description") ?? "",
      ...(image && HTTPS.test(image) ? { image } : {}),
    },
  }
}

export interface AwardContext {
  // Whether this key may issue badges for the club or tournament (from club or tournament
  // state). Without it, club and tournament awards are not accepted.
  mayIssue?: (scope: "club" | "tournament", scopeId: string, issuer: string) => boolean
  // false when the evidence was corrected or voided since; undefined when not known yet.
  evidenceValid?: (eventId: string) => boolean | undefined
}

export type AwardCheck =
  | { ok: true; key: string; recipient: string; issuer: string; self: boolean; evidence: string; occasion: string; definition: BadgeDefinitionInfo }
  | { ok: false; reason: Reason; detail: string }

// Checks an award against its definition (both signatures verified by lib/nostr first). The
// award's author must be the definition's author: nostr-core 1.0.4 does not check that
// (research PR-04), which is exactly how a forged award would pass.
export function checkBadgeAward(award: SignedEvent, definition: SignedEvent, ctx: AwardContext = {}): AwardCheck {
  const no = (reason: Reason, detail: string): AwardCheck => ({ ok: false, reason, detail })
  if (award.kind !== KIND_BADGE_AWARD) return no("wrong_kind", `kind ${award.kind}`)
  const labels = readLabels(award.tags)
  if (!labels || labels.type !== "badge.award") return no("not_blueline", "not a BlueLine award")
  if (labels.version !== FORMAT_VERSION) return no("unknown_version", `version ${labels.version}`)
  const def = checkBadgeDefinition(definition)
  if (!def.ok) return def

  const addresses = tagValues(award.tags, "a")
  if (addresses.length !== 1 || addresses[0] !== `${KIND_BADGE_DEFINITION}:${definition.pubkey}:${def.info.d}`) return no("issuer_mismatch", "award points at another definition")
  if (award.pubkey !== definition.pubkey) return no("issuer_mismatch", "award signed by someone other than the badge's issuer")
  const recipients = tagValues(award.tags, "p")
  if (recipients.length !== 1 || !HEX64.test(recipients[0])) return no("recipient_missing", "one recipient per award")
  const evidence = tagValues(award.tags, "e")
  if (evidence.length !== 1 || !HEX64.test(evidence[0])) return no("evidence_missing", "the award names what it rests on")
  const occasions = tagValues(award.tags, "occasion")
  if (occasions.length !== 1 || !OCCASION.test(occasions[0])) return no("occasion_mismatch", "occasion missing or malformed")

  const recipient = recipients[0]
  const { scope, scopeId } = def.info
  if (scope === "self" && recipient !== award.pubkey) return no("issuer_mismatch", "a self-earned badge is for its issuer only")
  if (scope === "club" || scope === "tournament") {
    if (!ctx.mayIssue || !ctx.mayIssue(scope, scopeId as string, award.pubkey)) return no("not_authorized", `not an issuer of this ${scope}`)
  }
  if (ctx.evidenceValid?.(evidence[0]) === false) return no("evidence_revoked", "the result it rests on was corrected or voided")
  return {
    ok: true,
    key: awardKey(award.pubkey, def.info.d, recipient, occasions[0]),
    recipient,
    issuer: award.pubkey,
    self: scope === "self",
    evidence: evidence[0],
    occasion: occasions[0],
    definition: def.info,
  }
}

// The same issuer, badge, recipient and occasion count once.
export const awardKey = (issuer: string, d: string, recipient: string, occasion: string) => `${issuer}|${d}|${recipient}|${occasion}`

// Keeps the first award per key in replay order (created_at, then id).
export function dedupeAwards<T extends { award: SignedEvent; key: string }>(awards: readonly T[]): T[] {
  const firstByKey = new Map<string, T>()
  for (const a of [...awards].sort((x, y) => byReplayOrder(x.award, y.award))) if (!firstByKey.has(a.key)) firstByKey.set(a.key, a)
  return [...firstByKey.values()]
}

// ---- Profile choice (NIP-58 kind 10008; the former kind 30008 with d=profile_badges is read) --

// Kind of the former profile choice, read but never written (PLAN.md, "Auszeichnungen").
export const KIND_PROFILE_BADGES_LEGACY = 30008

export interface ProfileBadge {
  // 30009:<issuer>:<d> of the definition.
  address: string
  // Id of the kind 8 award.
  award: string
  // Relay hints as other clients write them (["a", address, relay], ["e", award, relay]).
  addressRelay?: string
  awardRelay?: string
}

const ADDRESS = /^30009:[0-9a-f]{64}:[^\s]{1,200}$/

// The profile's choice, in its order: pairs of ["a", address] and ["e", award], each with its
// relay hint when it has one. `other` are tags of the list this code does not read as a pair
// (otherProfileTags); they are written back unchanged after the pairs, so a read-modify-write
// of a list another app wrote loses nothing.
export function profileBadgesTemplate(badges: readonly ProfileBadge[], created_at: number, other: readonly string[][] = []): EventTemplate {
  const tags: string[][] = []
  for (const b of badges) {
    if (!ADDRESS.test(b.address) || !HEX64.test(b.award)) throw new ProtocolError("invalid_content", "badge address or award id")
    tags.push(b.addressRelay ? ["a", b.address, b.addressRelay] : ["a", b.address], b.awardRelay ? ["e", b.award, b.awardRelay] : ["e", b.award])
  }
  for (const t of other) {
    if (!Array.isArray(t) || t.length === 0 || !t.every((v) => typeof v === "string")) throw new ProtocolError("invalid_tags", "a kept tag is not a list of strings")
    tags.push([...t])
  }
  const template = { kind: KIND_PROFILE_BADGES, created_at, tags, content: "" }
  if (signedEventBytes(template) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", "too many badges in one profile choice")
  return template
}

const isProfileChoice = (event: SignedEvent) =>
  event.kind === KIND_PROFILE_BADGES || (event.kind === KIND_PROFILE_BADGES_LEGACY && tagValue(event.tags, "d") === "profile_badges")

// Walks the list: the a/e pairs it reads, and every other tag (unknown tags, an "a" without its
// "e", an unreadable pair). The former list's d tag belongs to the old kind and is dropped.
function walkProfile(event: SignedEvent): { badges: ProfileBadge[]; other: string[][] } {
  const badges: ProfileBadge[] = []
  const other: string[][] = []
  let a: string[] | undefined
  for (const t of event.tags) {
    if (t[0] === "a") {
      if (a) other.push(a)
      a = t
    } else if (t[0] === "e" && a) {
      if (ADDRESS.test(a[1] ?? "") && HEX64.test(t[1] ?? "")) {
        badges.push({ address: a[1], award: t[1], ...(a[2] ? { addressRelay: a[2] } : {}), ...(t[2] ? { awardRelay: t[2] } : {}) })
      } else other.push(a, t)
      a = undefined
    } else if (!(t[0] === "d" && event.kind === KIND_PROFILE_BADGES_LEGACY)) other.push(t)
  }
  if (a) other.push(a)
  return { badges, other }
}

// Reads a 10008 choice, or a former 30008 one with d=profile_badges; anything else is null.
export const readProfileBadges = (event: SignedEvent): ProfileBadge[] | null => (isProfileChoice(event) ? walkProfile(event).badges : null)

// The tags of such a list that readProfileBadges does not return, for writing back.
export const otherProfileTags = (event: SignedEvent): string[][] | null => (isProfileChoice(event) ? walkProfile(event).other : null)
