import type { Messages } from "../index"

// English texts for the tournaments area. Same shape as tournaments.de.ts.
export const tournamentsEn: Messages["tournaments"] = {
  formats: {
    single: { name: "Knockout", summary: "Lose a match and you're out. Seeded players meet late." },
    double: { name: "Double elimination", summary: "You're out after your second loss. Lose once and you play on in the losers' bracket." },
    roundRobin: { name: "Round robin", summary: "Everyone plays everyone, the table decides." },
    groups: { name: "Groups, then knockout", summary: "Each group plays a round robin first, then the best of each group go on to a knockout." },
  },
  grandFinalReset: "Deciding match after the final",
  grandFinalResetHint: "If the player from the losers' bracket wins the final, they play again: only then have both lost once.",
  doubleRoundRobin: "Home and away",
  seeding: {
    seeded: (count) => (count === 1 ? "1 player seeded" : `${count} players seeded`),
    drawn: "Everyone is drawn",
    byes: "Byes go to the top seeds. They start straight in the second round.",
    reproducible: "The draw can be checked: with the same draw code, the same field always gives the same pairings.",
  },
  scoring: {
    title: "How the table works",
    points: "A win is worth 2 points. There are no draws.",
    order: "Players level on points are separated in this order:",
    walkover: "A match won by walkover counts as a win without legs.",
    inactive: "Anyone who withdraws or is disqualified goes to the bottom of the table and does not go through. Their opponents win the open matches by walkover.",
    inactiveAfterGroup: "If their group was already finished, they keep their place in the table. Their next opponent then wins by walkover.",
  },
  placing: {
    shared: "Players knocked out in the same round share the place.",
    disqualified: "Disqualified players get no place; everyone below moves up.",
  },
  tiebreak: {
    points: "Points",
    sets: "Set difference",
    legDifference: "Leg difference",
    legsWon: "Legs won",
    headToHead: "Head-to-head",
    lot: "Lot",
  },
  tiebreakHint: {
    sets: "Sets won minus sets lost, only when playing in sets",
    legDifference: "Legs won minus legs lost",
    legsWon: "More legs won",
    headToHead: "Wins in the matches among the players who are level; anyone still level is compared again among themselves only",
    lot: "A lot that was fixed at the draw",
  },
  state: {
    pending: "Opponent not known yet",
    ready: "Ready",
    live: "In play",
    finished: "Finished",
    walkover: "Walkover",
    void: "Not played",
  },
  walkover: {
    noShow: "Did not show up",
    retired: "Retired",
    withdrawn: "Withdrawn",
    bye: "Bye",
  },
  affected: "Affected by a correction",
  affectedHint: "An earlier result was changed. This match stays as entered until the organizer decides.",
  consequence: {
    result: "New result",
    players: "New pairing",
    affected: "Needs a decision",
    resolved: "Fits again",
  },
  status: {
    active: "Still in",
    eliminated: "Out",
    champion: "Winner",
    withdrawn: "Withdrawn",
    disqualified: "Disqualified",
  },
  rest: "Sits out",
  round: {
    final: "Final",
    semiFinal: "Semi-final",
    quarterFinal: "Quarter-final",
    lastSixteen: "Last 16",
    numbered: (round) => `Round ${round}`,
    winners: (round) => `Winners' round ${round}`,
    winnersFinal: "Winners' final",
    losers: (round) => `Losers' round ${round}`,
    losersFinal: "Losers' final",
    grandFinal: "Final",
    reset: "Deciding match",
    group: (group, round) => `Group ${group}, round ${round}`,
  },
  matchNumber: (number) => `Match ${number}`,
  place: (place, placeTo) => (place === placeTo ? `${ordinal(place)} place` : `${ordinal(place)}–${ordinal(placeTo)} place`),
  errors: {
    tooFewParticipants: "This format needs more players.",
    tooManyParticipants: "That many players don't fit this format.",
    duplicateParticipant: "This player is already in.",
    invalidParticipant: "Every player needs a name.",
    invalidSetup: "These settings don't go together.",
    unknownMatch: "This match isn't part of the tournament.",
    unknownParticipant: "This player isn't in the tournament.",
    notReady: "That's not possible for this match right now.",
    notInMatch: "This player isn't in this match.",
    playerBusy: "A player is in another match right now.",
    invalidScore: "The match can't end with this score.",
    boardBusy: "A match is already on this board.",
    noRecord: "Nothing has been entered for this match yet.",
    alreadyWithdrawn: "That's already entered.",
    notWithdrawn: "This player is still in the tournament.",
    tournamentComplete: "The tournament has already finished.",
    unsupportedEngine: "This tournament comes from a newer version of BlueLine. Update the app to open it.",
  },
}

// 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st …
function ordinal(n: number) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}
