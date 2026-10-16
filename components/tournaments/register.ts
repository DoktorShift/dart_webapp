"use client"

import type { ComponentType, ReactNode } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { TOURNAMENT_SCREENS } from "@/components/tournaments/screens"
import { featureOn } from "@/lib/shell/features"
import type { ScreenProps, SlotListProps } from "@/lib/shell/registry"
import { SCREENS, registerLinkHandler, registerScreen, registerSlot, registerSlotItem } from "@/lib/shell/registry"

// Where the tournaments area plugs into the shell (imported by components/shell/extensions.ts).
// Every piece loads on demand: the guest path carries this file and nothing of the tournaments.

const screen = (load: () => Promise<{ default: ComponentType<ScreenProps> }>) => lazyScreen<ScreenProps>(load)

if (featureOn("tournaments")) {
  registerSlot("tournaments.root", lazyScreen<{ fallback: ReactNode }>(() => import("@/components/tournaments/tournaments-home")))

  registerScreen(SCREENS.tournamentCreate, { title: (t) => t.shell.screens.tournamentCreate, Component: screen(() => import("@/components/tournaments/create-screen")) })
  registerScreen(SCREENS.tournamentView, { title: (t, params) => params.name || t.shell.screens.tournament, Component: screen(() => import("@/components/tournaments/tournament-screen")) })
  registerScreen(TOURNAMENT_SCREENS.organize, { title: (t) => t.tournaments.titles.organize, Component: screen(() => import("@/components/tournaments/organize-screen")) })
  registerScreen(TOURNAMENT_SCREENS.board, { title: (t, params) => params.name || t.tournaments.titles.board, Component: screen(() => import("@/components/tournaments/board-screen")) })
  registerScreen(TOURNAMENT_SCREENS.tv, { title: (t) => t.tournaments.titles.tv, largeTitle: false, Component: screen(() => import("@/components/tournaments/tv-screen")) })
  registerScreen(TOURNAMENT_SCREENS.print, { title: (t) => t.tournaments.titles.print, Component: screen(() => import("@/components/tournaments/print-screen")) })

  // A tournament game on the game screen: the result goes to the tournament (game.attachments),
  // and the result screen says so (result.actions). Both render nothing for any other game.
  registerSlotItem("game.attachments", "tournament", lazyScreen<SlotListProps["game.attachments"]>(() => import("@/components/tournaments/game-pieces").then((m) => ({ default: m.TournamentGate }))))
  registerSlotItem("result.actions", "tournament", lazyScreen<SlotListProps["result.actions"]>(() => import("@/components/tournaments/game-pieces").then((m) => ({ default: m.TournamentResultRow }))))

  // A /#tournament= link is the tournament itself (T1: opens it) or the organizer's code for one
  // of its boards (TB1: makes this device that board). The payload's prefix decides.
  registerLinkHandler("tournament", (link, nav, source) => {
    let payload: string
    try {
      payload = decodeURIComponent(link.payload)
    } catch {
      payload = link.payload
    }
    const board = payload.startsWith("TB1.")
    const screenId = board ? TOURNAMENT_SCREENS.board : SCREENS.tournamentView
    const params = { payload: link.payload }
    if (source === "scan" && nav.tab === "tournaments") nav.replaceTop(screenId, params)
    else nav.push(screenId, params, { tab: "tournaments" })
  })

  // A club's tournaments in the clubs area: the running or next one in the club's overview, all
  // of them (and "Turnier erstellen" for leaders) in "Termine & Turniere".
  registerSlotItem("club.tournaments", "tournaments", lazyScreen<SlotListProps["club.tournaments"]>(() => import("@/components/tournaments/club-tournaments")))
}
