import { areaTexts } from "../index.ts"
import { badgesScreensDe } from "./badges.screens.de.ts"
import { badgesScreensEn } from "./badges.screens.en.ts"

// The badges area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const BADGES_TEXTS = areaTexts({ de: badgesScreensDe, en: badgesScreensEn })
export type BadgesTexts = (typeof BADGES_TEXTS)["en"]
