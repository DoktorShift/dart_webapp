import { areaTexts } from "../index.ts"
import { profileScreensDe } from "./profile.screens.de.ts"
import { profileScreensEn } from "./profile.screens.en.ts"

// The profile area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const PROFILE_TEXTS = areaTexts({ de: profileScreensDe, en: profileScreensEn })
export type ProfileTexts = (typeof PROFILE_TEXTS)["en"]
