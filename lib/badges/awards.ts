import { latestEvents } from "../nostr/client.ts"
import { validateBadgeAward } from "../nostr/ext/validate.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { checkBadgeAward, dedupeAwards, type BadgeScope } from "../protocol/badges.ts"
import { KIND_BADGE_AWARD, KIND_BADGE_DEFINITION } from "../protocol/kinds.ts"
import { readLabels, tagValue, tagValues } from "../protocol/tags.ts"

// Received or given badges (NIP-58 kind 8 with their kind 30009 definitions), checked strictly
// before anything is shown (PLAN.md: "Vor Anzeige werden Signaturen, Definition, Aussteller,
// Empfänger, zusammengehörige Referenzen und gegebenenfalls die Clubberechtigung geprüft"):
//
// - Both signatures, the award from the definition's author pointing at exactly it, the
//   recipient named (lib/nostr/ext/validate.ts; nostr-core 1.0.4 accepts forged awards).
// - BlueLine's own badges also by their rules (lib/protocol/badges.ts checkBadgeAward): a
//   "Selbst erreicht" badge only for its issuer, a club or tournament badge only from someone
//   that club or tournament lets award it. Who that is, only the clubs and tournaments areas
//   know: they register a check (registerIssuerCheck). Until one answers yes, such a badge is
//   not shown at all.
// - An award its issuer asked to delete (NIP-09) is gone; the same badge for the same occasion
//   counts once however often it arrives.
//
// Badges of other apps pass on the generic checks and are shown as theirs, with their issuer.

export interface ValidAward {
  // The kind 8 award and the kind 30009 definition it points at.
  award: NostrEvent
  definition: NostrEvent
  issuer: string
  recipient: string
  name: string
  description: string
  image: string | null
  // The same issuer, badge, recipient and occasion count once (lib/protocol/badges.ts awardKey).
  key: string
  // BlueLine's reading of its own badges; null for another app's.
  blueline: { scope: BadgeScope; scopeId?: string; badge: string; version: number; evidence: string; occasion: string } | null
  // The result or decision it rests on was corrected or voided since (its issuer's area says so).
  voided: boolean
}

// What the clubs and tournaments areas know about who may award their badges.
export interface IssuerCheck {
  // Whether `issuer` may award badges of this club or tournament; undefined while unknown.
  mayIssue(scopeId: string, issuer: string): Promise<boolean | undefined>
  // false once the result or decision an award rests on was corrected or voided.
  evidenceValid?(scopeId: string, evidence: string): Promise<boolean | undefined>
}

const issuerChecks = new Map<"club" | "tournament", IssuerCheck>()

// Registered by the clubs and tournaments areas (their register modules), once at start.
export function registerIssuerCheck(scope: "club" | "tournament", check: IssuerCheck) {
  issuerChecks.set(scope, check)
  return () => {
    if (issuerChecks.get(scope) === check) issuerChecks.delete(scope)
  }
}

const HTTPS = /^https:\/\/[^\s"<>\\]+$/
const addressOf = (award: NostrEvent) => tagValue(award.tags, "a") ?? ""

// The definition an award points at: the newest version its issuer published under that d.
function definitionFor(award: NostrEvent, definitions: readonly NostrEvent[]): NostrEvent | null {
  const [kind, issuer, ...rest] = addressOf(award).split(":")
  const d = rest.join(":")
  if (kind !== String(KIND_BADGE_DEFINITION) || issuer !== award.pubkey) return null
  return latestEvents(definitions.filter((def) => def.pubkey === issuer && tagValue(def.tags, "d") === d))[0] ?? null
}

// The events without those their own author asked to delete (NIP-09); the requests stay, so
// copies that arrive again are dropped again.
export function withoutDeleted(events: readonly NostrEvent[]): NostrEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  const gone = new Set<string>()
  for (const deletion of events.filter((e) => e.kind === 5))
    for (const id of tagValues(deletion.tags, "e")) if (byId.get(id)?.pubkey === deletion.pubkey) gone.add(id)
  return [...byId.values()].filter((e) => !gone.has(e.id))
}

const isBlueLine = (event: NostrEvent) => readLabels(event.tags) !== null

interface Scoped {
  scope: "club" | "tournament"
  scopeId: string
  issuer: string
  evidence: string
}

// Asks the registered checks about every club and tournament award at once.
async function askIssuers(scoped: readonly Scoped[]) {
  const may = new Map<string, boolean | undefined>()
  const valid = new Map<string, boolean | undefined>()
  await Promise.all(
    scoped.map(async ({ scope, scopeId, issuer, evidence }) => {
      const check = issuerChecks.get(scope)
      may.set(`${scope}|${scopeId}|${issuer}`, await check?.mayIssue(scopeId, issuer).catch(() => undefined))
      valid.set(evidence, await check?.evidenceValid?.(scopeId, evidence).catch(() => undefined))
    }),
  )
  return {
    mayIssue: (scope: "club" | "tournament", scopeId: string, issuer: string) => may.get(`${scope}|${scopeId}|${issuer}`) === true,
    evidenceValid: (id: string) => valid.get(id),
  }
}

// The scope tag of a BlueLine definition, read before the full check (which needs the answers).
function scopedOf(award: NostrEvent, definition: NostrEvent): Scoped | null {
  const scope = definition.tags.find((t) => t[0] === "scope")
  const evidence = tagValue(award.tags, "e")
  if ((scope?.[1] !== "club" && scope?.[1] !== "tournament") || !scope[2] || !evidence) return null
  return { scope: scope[1], scopeId: scope[2], issuer: award.pubkey, evidence }
}

// The valid awards among `events` (awards, definitions and deletion requests, in any order and
// any number of copies), for `recipient` if given, oldest first. The events come from relays
// (lib/nostr checks every signature on receipt) or from ./store.ts (which checks what it reads
// back); award and definition signatures are checked once more with the award.
export async function validAwards(events: readonly NostrEvent[], recipient?: string): Promise<ValidAward[]> {
  const present = withoutDeleted(events)
  const definitions = present.filter((e) => e.kind === KIND_BADGE_DEFINITION)
  const candidates = present
    .filter((e) => e.kind === KIND_BADGE_AWARD && (recipient === undefined || tagValues(e.tags, "p").includes(recipient)))
    .flatMap((award) => {
      const definition = definitionFor(award, definitions)
      return definition ? [{ award, definition }] : []
    })
  const issuers = await askIssuers(candidates.flatMap(({ award, definition }) => scopedOf(award, definition) ?? []))

  const checked: ValidAward[] = []
  for (const { award, definition } of candidates) {
    const to = recipient ?? tagValue(award.tags, "p") ?? ""
    if (!(await validateBadgeAward(award, definition, to)).ok) continue
    const name = tagValue(definition.tags, "name") ?? tagValue(definition.tags, "d") ?? ""
    const image = tagValue(definition.tags, "image") ?? ""
    const base = { award, definition, issuer: award.pubkey, recipient: to, name, description: tagValue(definition.tags, "description") ?? "", image: HTTPS.test(image) ? image : null }
    if (!isBlueLine(award) && !isBlueLine(definition)) {
      checked.push({ ...base, key: `${addressOf(award)}|${to}`, blueline: null, voided: false })
      continue
    }
    const result = checkBadgeAward(award, definition, { mayIssue: issuers.mayIssue })
    if (!result.ok) continue
    const { scope, scopeId, badge, version } = result.definition
    const blueline = { scope, ...(scopeId ? { scopeId } : {}), badge, version, evidence: result.evidence, occasion: result.occasion }
    checked.push({ ...base, key: result.key, blueline, voided: issuers.evidenceValid(result.evidence) === false })
  }
  // One per key: the first given, in replay order, which is also the order returned.
  return dedupeAwards(checked)
}
