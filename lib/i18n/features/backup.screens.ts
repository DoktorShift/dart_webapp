import { areaTexts } from "../index.ts"
import { backupScreensDe } from "./backup.screens.de.ts"
import { backupScreensEn } from "./backup.screens.en.ts"

// The backup area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const BACKUP_TEXTS = areaTexts({ de: backupScreensDe, en: backupScreensEn })
export type BackupTexts = (typeof BACKUP_TEXTS)["en"]
