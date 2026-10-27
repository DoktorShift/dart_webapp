// What a payment was for, read from the key of its action (lib/payments/journal.ts `actions`):
// the game it belongs to and its kind, so a payment can name its game and a game its payment.
// Nothing new is stored; the keys have carried this since the first payment.

export type ActionKind = "stake" | "pay" | "receive" | "congratulate" | "single"

export interface ActionInfo {
  kind: ActionKind
  // The game the payment belongs to, when it has one.
  matchId?: string
  playerId?: string
  pubkey?: string
}

export function describeAction(action: string): ActionInfo {
  const [kind, ...rest] = action.split(":")
  switch (kind) {
    case "stake":
      return { kind, matchId: rest[0] }
    case "pay":
      return { kind, matchId: rest[0], playerId: rest.slice(1).join(":") }
    case "receive":
      return { kind, matchId: rest[0] }
    case "congratulate":
      // "congratulate:<match>:<pubkey>" after a game, "congratulate:<pubkey>" from a profile.
      return rest.length >= 2 ? { kind, matchId: rest[0], pubkey: rest[1] } : { kind, pubkey: rest[0] }
    default:
      return { kind: "single" }
  }
}
