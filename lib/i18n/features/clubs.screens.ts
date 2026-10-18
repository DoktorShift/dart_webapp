import { areaTexts } from "../index.ts"
import { clubsScreensDe } from "./clubs.screens.de.ts"
import { clubsScreensEn } from "./clubs.screens.en.ts"

// The clubs area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const CLUBS_TEXTS = areaTexts({ de: clubsScreensDe, en: clubsScreensEn })
export type ClubsTexts = (typeof CLUBS_TEXTS)["en"]
