import { areaTexts } from "../index.ts"
import { syncScreensDe } from "./sync.screens.de.ts"
import { syncScreensEn } from "./sync.screens.en.ts"

// The sync area's texts, loaded with the screens that show them (useAreaT in components/i18n-provider.tsx).
export const SYNC_TEXTS = areaTexts({ de: syncScreensDe, en: syncScreensEn })
export type SyncTexts = (typeof SYNC_TEXTS)["en"]
