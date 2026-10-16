"use client"

import { ArrowRightLeft, Radio, Smartphone } from "lucide-react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { JoinedGate, LiveGate, LiveResultGate, openLiveSheet } from "@/components/live/gate"
import { SCREENS, registerGameMenuItem, registerScreen, registerSlotItem } from "@/lib/shell/registry"

// The live area in the app shell (lib/shell/registry.ts): three entries in the running game's
// options menu, their sheets over the game, the players' verdicts on the result, this phone's
// seats at boards on the Play tab, and the screens that watch links, board codes and handoff
// codes open.

registerGameMenuItem({ id: "live.watch", label: (t) => t.live.menu.watch, icon: Radio, onSelect: ({ match }) => openLiveSheet(match.id, "watch") })
registerGameMenuItem({ id: "live.players", label: (t) => t.live.menu.players, icon: Smartphone, onSelect: ({ match }) => openLiveSheet(match.id, "players") })
registerGameMenuItem({ id: "live.handoff", label: (t) => t.live.menu.handoff, icon: ArrowRightLeft, onSelect: ({ match }) => openLiveSheet(match.id, "handoff") })

registerSlotItem("game.attachments", "live", LiveGate)
registerSlotItem("result.actions", "live", LiveResultGate)
registerSlotItem("play.rows", "live", JoinedGate)

registerScreen(SCREENS.liveWatch, { title: (t) => t.live.titles.watch, largeTitle: false, Component: lazyScreen(() => import("@/components/live/watch-screen")) })
registerScreen(SCREENS.liveBoard, { title: (t) => t.live.titles.board, Component: lazyScreen(() => import("@/components/live/board-screen")) })
registerScreen(SCREENS.liveHandoff, { title: (t) => t.live.titles.takeover, Component: lazyScreen(() => import("@/components/live/takeover-screen")) })
