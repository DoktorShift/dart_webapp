import { areaTexts } from "../index.ts"
import { liveScreensDe } from "./live.screens.de.ts"
import { liveScreensEn } from "./live.screens.en.ts"

// The live area's texts, loaded with its screens and sheets (useAreaT in components/i18n-provider.tsx).
export const LIVE_TEXTS = areaTexts({ de: liveScreensDe, en: liveScreensEn })
