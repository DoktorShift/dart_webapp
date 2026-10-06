import { areaTexts } from "../index.ts"
import { tournamentsScreensDe } from "./tournaments.screens.de.ts"
import { tournamentsScreensEn } from "./tournaments.screens.en.ts"

// The tournaments area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const TOURNAMENTS_TEXTS = areaTexts({ de: tournamentsScreensDe, en: tournamentsScreensEn })
