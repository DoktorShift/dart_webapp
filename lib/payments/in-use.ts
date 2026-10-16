// Whether payments are in use on this device: a wallet connected, or a payment in the journal.
// The payment screens and rows load only then (components/payments/gate.tsx), so a guest who never
// used payments loads nothing of them. Only the database is read here.
import { dbGet, dbKeys } from "../storage/db.ts"

// Where the wallet connection is kept (./wallet.ts). A "profile.*" key: it goes with the profile
// when it signs out or another one signs in (lib/profile/session.ts).
export const WALLET_KEY = "profile.wallet"

export interface PaymentsUse {
  wallet: boolean
  payments: boolean
}

export async function paymentsInUse(): Promise<PaymentsUse> {
  try {
    const [wallet, payments] = await Promise.all([dbGet("kv", WALLET_KEY), dbKeys("payments")])
    return { wallet: wallet !== undefined, payments: payments.length > 0 }
  } catch {
    return { wallet: false, payments: false }
  }
}
