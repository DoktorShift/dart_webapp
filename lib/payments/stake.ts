// The stake of a game ("Einsatz", PLAN.md "Direkte Zahlungen und vereinbarte Einsätze"): an
// amount in sats the loser pays the winner, noted in setup and kept with the game as
// config.extras["payments.stake"]. Only between two players. Noting it pays nothing: after the
// game the players decide, and every payment is confirmed on its own.
import type { MatchPlayer } from "../game/types.ts"

export const STAKE_EXTRA = "payments.stake"
// Every amount this app pays, asks for or notes is whole sats up to this.
export const MAX_SATS = 1_000_000
const isSatsAmount = (sats: number) => Number.isSafeInteger(sats) && sats >= 1 && sats <= MAX_SATS
// Offered wherever an amount is chosen (stake, receiving, paying); any other can be typed.
export const AMOUNT_PRESETS = [100, 500, 1000, 5000] as const

export interface Stake {
  sats: number
}

// The stake as setup stores it, or null (none, or a value this version can't read).
export function readStake(value: unknown): Stake | null {
  const sats = (value as Partial<Stake> | null)?.sats
  return typeof sats === "number" && isSatsAmount(sats) ? { sats } : null
}

export interface StakeParties {
  payer: MatchPlayer
  payee: MatchPlayer
  sats: number
}

// Who pays whom after a finished game with a stake; null without one, or not two players.
export function stakeParties(match: { players: readonly MatchPlayer[]; winner: number; extras?: Readonly<Record<string, unknown>> }): StakeParties | null {
  const stake = readStake(match.extras?.[STAKE_EXTRA])
  if (!stake || match.players.length !== 2) return null
  const payee = match.players[match.winner]
  const payer = match.players[1 - match.winner]
  return payee && payer ? { payer, payee, sats: stake.sats } : null
}

// What the result of a finished game offers: its stake, or, with a wallet connected and someone
// else in the game, paying or receiving freely. Null: nothing (the result looks as before).
export function resultOffer(match: { players: readonly MatchPlayer[]; winner: number; solo: boolean; config: { extras?: Readonly<Record<string, unknown>> } }, walletConnected: boolean): { kind: "stake"; parties: StakeParties } | { kind: "free" } | null {
  const parties = stakeParties({ players: match.players, winner: match.winner, extras: match.config.extras })
  if (parties) return { kind: "stake", parties }
  return walletConnected && !match.solo ? { kind: "free" } : null
}

// Which side of the stake this device is on, when a player is linked to the signed-in profile
// (`linked` gives a player's profile key). Null when it can't tell: then both sides are offered.
export function deviceSide(parties: StakeParties, linked: (playerId: string) => string | undefined, me: string | null): "payer" | "payee" | null {
  if (!me) return null
  if (linked(parties.payer.id) === me) return "payer"
  if (linked(parties.payee.id) === me) return "payee"
  return null
}
