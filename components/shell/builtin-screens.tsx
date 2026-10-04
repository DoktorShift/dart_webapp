"use client"

import { AboutScreen, OpenClubInvite, OpenTournamentInvite, SettingsEntry } from "@/components/shell/lazy"
import { PlaceholderScreen } from "@/components/shell/placeholder-screen"
import type { Messages } from "@/lib/i18n"
import { SCREENS, registerScreen } from "@/lib/shell/registry"

// The screens the shell brings itself: Settings and About for everyone, and a neutral
// placeholder with the right title for every screen an area will fill in later. An area replaces
// a placeholder by registering the same id (see components/shell/extensions.ts).

registerScreen(SCREENS.settings, { title: (t) => t.settings.title, largeTitle: false, Component: SettingsEntry })
registerScreen(SCREENS.about, { title: (t) => t.nav.about, largeTitle: false, Component: AboutScreen })

registerScreen(SCREENS.clubOpenInvite, { title: (t) => t.shell.screens.openInvite, Component: OpenClubInvite })
registerScreen(SCREENS.tournamentOpenInvite, { title: (t) => t.shell.screens.openInvite, Component: OpenTournamentInvite })

const placeholders: [string, (t: Messages) => string][] = [
  [SCREENS.profileCreate, (t) => t.profile.guest.create],
  [SCREENS.profileFromDevice, (t) => t.profile.guest.fromDevice],
  [SCREENS.profileFromBackup, (t) => t.profile.guest.fromBackup],
  [SCREENS.profileFromApp, (t) => t.profile.guest.fromApp],
  [SCREENS.profilePublic, (t) => t.shell.screens.publicProfile],
  [SCREENS.devicesPair, (t) => t.shell.screens.pair],
  [SCREENS.clubCreate, (t) => t.shell.screens.clubCreate],
  [SCREENS.clubInvite, (t) => t.shell.screens.clubInvite],
  [SCREENS.tournamentCreate, (t) => t.shell.screens.tournamentCreate],
  [SCREENS.tournamentView, (t) => t.shell.screens.tournament],
  [SCREENS.liveWatch, (t) => t.shell.screens.watch],
  [SCREENS.liveBoard, (t) => t.shell.screens.board],
]
for (const [id, title] of placeholders) registerScreen(id, { title, Component: PlaceholderScreen })
