"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { exchangeRate } from "@/lib/nostr/wallet"
import { loadJournal, recoverInterrupted, type PaymentEntry } from "@/lib/payments/journal"
import { loadWallet, type WalletInfo } from "@/lib/payments/wallet"
import { returnedConnection, subscribeReturned, type ReturnedConnection } from "@/lib/payments/wallet-return"
import { useStored } from "@/lib/storage/hooks"

// React access to the wallet connection, the payment journal and a wallet app's answer. The
// stored ones read once, then follow changes from this tab and from other tabs.

const readWallet = () => loadWallet().catch(() => null)

// The wallet connected on this device: undefined while reading, null when there is none.
export const useWallet = (): WalletInfo | null | undefined => useStored("kv", readWallet)[0]

// Payments a closed page left "sending" turn unknown once per page load, before the first read.
let recovered: Promise<void> | null = null
const readJournal = async () => {
  recovered ??= recoverInterrupted().catch(() => {})
  await recovered
  return loadJournal().catch((): PaymentEntry[] => [])
}

// Every payment on this device, newest first; undefined until read.
export const useJournal = (): PaymentEntry[] | undefined => useStored("payments", readJournal)[0]

const noReturn = () => null

// The connection a wallet app sent back ("Wallet-App öffnen"), until it is confirmed or dismissed.
export const useReturnedConnection = (): ReturnedConnection | null => useSyncExternalStore(subscribeReturned, returnedConnection, noReturn)

// The euro price of a bitcoin and when it was fetched, for "≈ 0,32 €" next to an amount. Null
// while unknown and when it can't be had: the approximation is then just left out (decision 0001
// F4). The amount in sats is always what counts.
export function useEuroRate(): { rate: number; at: number } | null {
  const [rate, setRate] = useState<{ rate: number; at: number } | null>(null)
  useEffect(() => {
    let alive = true
    exchangeRate("eur").then(
      (value) => alive && setRate(value),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [])
  return rate
}
