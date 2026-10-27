// How this device shows money (Zahlungen › Einstellungen): the currency, which side comes first,
// and whether the profile's row shows the last known balance. Kept in kv "payments.settings" on
// this device only, like the rate; a new device starts from its region. Beside it, the figures
// the wallet last reported ("payments.figures"), so the home screen and the profile's row show a
// balance at once without waking the wallet.
import { dbGet, kvGet, kvSet } from "../storage/db.ts"
import type { Budget } from "../nostr/wallet.ts"
import { defaultCurrency, isCurrency, type Currency } from "./money.ts"
import { capabilities, withWallet, type WalletInfo } from "./wallet.ts"

const KEY = "payments.settings"
const FIGURES_KEY = "payments.figures"

export type MoneyOrder = "fiat" | "bitcoin"

export interface MoneySettings {
  currency: Currency
  order: MoneyOrder
  balanceInProfile: boolean
}

const DEFAULTS: Omit<MoneySettings, "currency"> = { order: "fiat", balanceInProfile: true }

const fallbackCurrency = () => defaultCurrency(typeof navigator === "undefined" ? undefined : navigator.language)

export async function loadMoneySettings(): Promise<MoneySettings> {
  const stored = await kvGet<Partial<MoneySettings>>(KEY).catch(() => undefined)
  return {
    currency: isCurrency(stored?.currency) ? stored.currency : fallbackCurrency(),
    order: stored?.order === "bitcoin" ? "bitcoin" : DEFAULTS.order,
    balanceInProfile: typeof stored?.balanceInProfile === "boolean" ? stored.balanceInProfile : DEFAULTS.balanceInProfile,
  }
}

export async function saveMoneySettings(patch: Partial<MoneySettings>): Promise<void> {
  const current = await loadMoneySettings()
  await kvSet(KEY, { ...current, ...patch })
}

// What the wallet last reported, for which connection, and when (ms).
export interface WalletFigures {
  connection: string
  at: number
  balanceMsat: number | null
  budget: Budget | null
}

export async function loadWalletFigures(): Promise<WalletFigures | null> {
  const stored = await dbGet<{ id: string; value: WalletFigures }>("kv", FIGURES_KEY).catch(() => undefined)
  return stored?.value ?? null
}

export const saveWalletFigures = (figures: WalletFigures) => kvSet(FIGURES_KEY, figures)

// Asks the wallet for what it can report, keeps the answer and returns it. Null when it reports
// neither. Throws when the wallet can't be reached.
export async function fetchWalletFigures(info: WalletInfo): Promise<WalletFigures | null> {
  const can = capabilities(info)
  if (!can.balance && !can.budget) return null
  const figures = await withWallet(async (wallet) => {
    const [balance, budget] = await Promise.allSettled([can.balance ? wallet.getBalance() : null, can.budget ? wallet.getBudget() : null])
    return {
      connection: info.connection,
      at: Date.now(),
      balanceMsat: balance.status === "fulfilled" ? balance.value : null,
      budget: budget.status === "fulfilled" ? budget.value : null,
    }
  })
  await saveWalletFigures(figures).catch(() => {})
  return figures
}
