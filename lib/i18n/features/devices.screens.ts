import { areaTexts } from "../index.ts"
import { devicesScreensDe } from "./devices.screens.de.ts"
import { devicesScreensEn } from "./devices.screens.en.ts"

// The devices area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const DEVICES_TEXTS = areaTexts({ de: devicesScreensDe, en: devicesScreensEn })
export type DevicesTexts = (typeof DEVICES_TEXTS)["en"]
