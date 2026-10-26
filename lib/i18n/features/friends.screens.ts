import { areaTexts } from "../index.ts"
import { friendsScreensDe } from "./friends.screens.de.ts"
import { friendsScreensEn } from "./friends.screens.en.ts"

// The friends area's texts, loaded with its screens (useAreaT in components/i18n-provider.tsx).
export const FRIENDS_TEXTS = areaTexts({ de: friendsScreensDe, en: friendsScreensEn })
export type FriendsTexts = (typeof FRIENDS_TEXTS)["en"]
