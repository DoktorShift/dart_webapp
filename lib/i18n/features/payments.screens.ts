import { areaTexts, type Widen } from "../index.ts"
import { paymentsScreensDe } from "./payments.screens.de.ts"
import { paymentsScreensEn } from "./payments.screens.en.ts"

// The payments area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const PAYMENTS_TEXTS = areaTexts({ de: paymentsScreensDe, en: paymentsScreensEn })

export type PaymentTexts = Widen<typeof paymentsScreensDe>
