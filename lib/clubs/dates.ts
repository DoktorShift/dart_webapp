import { loadCore } from "../nostr/core.ts"
import { latestEvents } from "../nostr/client.ts"
import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import { clubRoleAt } from "../protocol/club-state.ts"
import { buildRecord } from "../protocol/records.ts"
import { newObjectId } from "../storage/ids.ts"
import { afterState, send, type Author, type Sent } from "./send.ts"

// Club dates (docs/protocol/families/club.md, "Termine"): a public club's dates are NIP-52
// time-based calendar events (kind 31923) with answers as NIP-52 RSVPs (31925), so calendar
// apps see them too; a closed club's dates are sealed club.date records with club.rsvp answers,
// which NIP-52 has no encrypted form for. Both read as the same ClubDate below. A recurring
// club night is one date per evening (PLAN.md "Turniere": "als einzelne Termine").

export const CALENDAR_TIME_KIND = 31923
export const CALENDAR_RSVP_KIND = 31925
const CANCELLED: string[] = ["status", "cancelled"]
const ANSWER_OF = { accepted: "yes", tentative: "maybe", declined: "no" } as const
const STATUS_OF = { yes: "accepted", maybe: "tentative", no: "declined" } as const

export type Answer = "yes" | "maybe" | "no"

export interface ClubDate {
  // The date's own id: club.date's, or the NIP-52 address ("31923:<author>:<d>").
  id: string
  title: string
  starts: number
  ends?: number
  place?: string
  note?: string
  cancelled: boolean
  by: string
  // Answers by member: the newest each, and when it was given.
  answers: Record<string, { answer: Answer; at: number }>
  // What a change builds on: the club.date record (closed), or the calendar event (public).
  head: string
  at: number
  calendar?: { d: string; event: NostrEvent }
}

export function closedDates(state: ClubState): ClubDate[] {
  return Object.values(state.dates)
    .map((d) => ({
      id: d.id,
      title: d.title,
      starts: d.starts,
      ...(d.ends !== undefined ? { ends: d.ends } : {}),
      ...(d.place ? { place: d.place } : {}),
      ...(d.note ? { note: d.note } : {}),
      cancelled: d.cancelled,
      by: d.by,
      answers: Object.fromEntries(Object.entries(d.answers).map(([pubkey, a]) => [pubkey, { answer: a.answer, at: a.at }])),
      head: d.head,
      at: d.at,
    }))
    .sort((a, b) => a.starts - b.starts)
}

const isLeader = (state: ClubState, pubkey: string, at: number) => {
  const role = clubRoleAt(state, pubkey, at)
  return role === "owner" || role === "admin" || role === "director"
}

// A public club's dates: calendar events naming the club, by someone who led it when they wrote
// them (newest version each); answers by members, the newest per member.
export async function publicDates(events: readonly NostrEvent[], state: ClubState): Promise<ClubDate[]> {
  const core = await loadCore()
  const calendar = latestEvents(events.filter((e) => e.kind === CALENDAR_TIME_KIND && e.tags.some((t) => t[0] === "e" && t[1] === state.id)))
  const answers = latestEvents(events.filter((e) => e.kind === CALENDAR_RSVP_KIND))
  const dates: ClubDate[] = []
  for (const event of calendar) {
    if (!isLeader(state, event.pubkey, event.created_at)) continue
    const parsed = core.parseTimeBasedCalendarEvent(event)
    if (!parsed.identifier || !parsed.title || !Number.isSafeInteger(parsed.start)) continue
    const address = core.buildCalendarEventAddress(CALENDAR_TIME_KIND, event.pubkey, parsed.identifier)
    const said: ClubDate["answers"] = {}
    for (const rsvp of answers) {
      const r = core.parseCalendarEventRSVP(rsvp)
      // Newest first: a member's older answers (another app's, under another "d") don't count.
      if (r.calendarEventAddress === address && !(rsvp.pubkey in said) && clubRoleAt(state, rsvp.pubkey, rsvp.created_at)) said[rsvp.pubkey] = { answer: ANSWER_OF[r.status], at: rsvp.created_at }
    }
    dates.push({
      id: address,
      title: parsed.title,
      starts: parsed.start,
      ...(parsed.end ? { ends: parsed.end } : {}),
      ...(parsed.locations?.[0] ? { place: parsed.locations[0] } : {}),
      ...(parsed.content ? { note: parsed.content } : {}),
      cancelled: event.tags.some((t) => t[0] === CANCELLED[0] && t[1] === CANCELLED[1]),
      by: event.pubkey,
      answers: said,
      head: event.id,
      at: event.created_at,
      calendar: { d: parsed.identifier, event },
    })
  }
  return dates.sort((a, b) => a.starts - b.starts)
}

export interface DateInput {
  title: string
  starts: number
  ends?: number
  place?: string
  note?: string
}

const DAY = 24 * 60 * 60

// The evenings of a recurring club night: `count` dates, `everyDays` apart.
export function repeatDates(first: DateInput, everyDays: number, count: number): DateInput[] {
  return Array.from({ length: count }, (_, i) => ({
    ...first,
    starts: first.starts + i * everyDays * DAY,
    ...(first.ends !== undefined ? { ends: first.ends + i * everyDays * DAY } : {}),
  }))
}

async function calendarTemplate(state: ClubState, d: string, input: DateInput & { cancelled?: boolean }, previous?: ClubDate): Promise<EventTemplate> {
  const core = await loadCore()
  const template = core.createTimeBasedCalendarEventTemplate({
    identifier: d,
    title: input.title,
    start: input.starts,
    ...(input.ends !== undefined ? { end: input.ends } : {}),
    ...(input.place ? { locations: [input.place] } : {}),
    ...(input.note ? { content: input.note } : {}),
    extraTags: [["e", state.id], ...(input.cancelled ? [CANCELLED] : [])],
  })
  return { ...template, created_at: afterState(state, previous?.at ?? 0) }
}

function closedTemplate(state: ClubState, id: string, input: DateInput & { cancelled?: boolean }, previous?: ClubDate): EventTemplate {
  const content = {
    date: id,
    title: input.title,
    starts: input.starts,
    ...(input.ends !== undefined ? { ends: input.ends } : {}),
    ...(input.place ? { place: input.place } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.cancelled ? { cancelled: true } : {}),
    prev: previous?.head ?? state.id,
  }
  return buildRecord("club.date", content, { created_at: afterState(state), root: state.id })
}

const members = (state: ClubState) => Object.keys(state.members)

// New dates (several for a recurring club night), or a new version of one (`previous`): a
// change, or with `cancelled` its cancellation.
export async function saveDates(state: ClubState, inputs: readonly (DateInput & { cancelled?: boolean })[], author: Author, previous?: ClubDate): Promise<Sent> {
  if (state.info.visibility === "closed") {
    const readers = members(state)
    return send(state.id, inputs.map((input) => ({ template: closedTemplate(state, previous?.id ?? newObjectId(), input, previous), seal: { readers } })), author)
  }
  const templates = await Promise.all(inputs.map((input) => calendarTemplate(state, previous?.calendar?.d ?? newObjectId(), input, previous)))
  return send(state.id, templates.map((template) => ({ template })), author)
}

export const cancelDate = (state: ClubState, date: ClubDate, author: Author) => saveDates(state, [{ ...date, cancelled: true }], author, date)

// This member's answer to a date, dated after their last one so it replaces it. NIP-52 answers
// are addressable per date.
export async function answerDate(state: ClubState, date: ClubDate, answer: Answer, author: Author): Promise<Sent> {
  const at = afterState(state, date.at, date.answers[author.pubkey]?.at ?? 0)
  if (state.info.visibility === "closed") {
    const template = buildRecord("club.rsvp", { date: date.id, answer }, { created_at: at, root: state.id })
    return send(state.id, [{ template, seal: { readers: members(state) } }], author)
  }
  const core = await loadCore()
  const template = core.createCalendarEventRSVPTemplate({
    identifier: `blueline-${date.calendar?.d ?? date.id}`,
    calendarEventAddress: date.id,
    calendarEventAuthor: date.by,
    status: STATUS_OF[answer],
  })
  return send(state.id, [{ template: { ...template, created_at: at } }], author)
}
