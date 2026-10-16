"use client";

import type { ComponentType, ReactNode } from "react";
import { lazyScreen } from "@/components/nav/lazy-screen";
import { featureOn } from "@/lib/shell/features";
import { CLUB_SCREENS } from "@/components/clubs/screens";
import { registerIssuerCheck } from "@/lib/badges/issuers";
import { addDiagnostics } from "@/lib/profile/diagnostics";
import type { ScreenProps, SlotListProps } from "@/lib/shell/registry";
import {
  SCREENS,
  registerScreen,
  registerSlot,
  registerSlotItem,
} from "@/lib/shell/registry";

// Where the clubs area plugs into the shell (imported by components/shell/extensions.ts). Every
// piece loads on demand: the guest path carries this file and nothing of the clubs.

const screen = (load: () => Promise<{ default: ComponentType<ScreenProps> }>) =>
  lazyScreen<ScreenProps>(load);

if (featureOn("clubs")) {
  registerSlot(
    "clubs.root",
    lazyScreen<{ fallback: ReactNode }>(
      () => import("@/components/clubs/clubs-home"),
    ),
  );
  registerSlotItem(
    "result.actions",
    "clubs.record",
    lazyScreen<SlotListProps["result.actions"]>(
      () => import("@/components/clubs/result-action"),
    ),
  );

  registerScreen(SCREENS.clubCreate, {
    title: (t) => t.shell.screens.clubCreate,
    Component: screen(() => import("@/components/clubs/create-screen")),
  });
  registerScreen(SCREENS.clubInvite, {
    title: (t) => t.shell.screens.clubInvite,
    Component: screen(() => import("@/components/clubs/invite-screen")),
  });
  registerScreen(CLUB_SCREENS.view, {
    title: (t, params) => params.name || t.clubs.titles.club,
    Component: screen(() => import("@/components/clubs/club-screen")),
  });
  registerScreen(CLUB_SCREENS.members, {
    title: (t) => t.clubs.titles.members,
    Component: screen(() => import("@/components/clubs/members-screen")),
  });
  registerScreen(CLUB_SCREENS.table, {
    title: (t) => t.clubs.titles.table,
    Component: screen(() => import("@/components/clubs/table-screen")),
  });
  registerScreen(CLUB_SCREENS.dates, {
    title: (t) => t.clubs.titles.dates,
    Component: screen(() => import("@/components/clubs/dates-screen")),
  });
  registerScreen(CLUB_SCREENS.manage, {
    title: (t) => t.clubs.titles.manage,
    Component: screen(() => import("@/components/clubs/manage-screen")),
  });
  registerScreen(CLUB_SCREENS.season, {
    title: (t) => t.clubs.titles.season,
    Component: screen(() => import("@/components/clubs/season-screen")),
  });
  registerScreen(CLUB_SCREENS.discover, {
    title: (t) => t.clubs.titles.discover,
    Component: screen(() => import("@/components/clubs/discover-screen")),
  });

  // Who may award a club's badges and whether a season's awards still stand: asked by the badges
  // area while it checks awards, answered from the club's copy here (./awards.ts, loaded then).
  const awards = () => import("@/components/clubs/awards");
  registerIssuerCheck("club", {
    mayIssue: async (club, issuer, at) =>
      (await awards()).mayAward(club, issuer, at),
    evidenceValid: async (club, evidence) =>
      (await awards()).awardsStand(club, evidence),
  });

  // "Diagnose kopieren" (Profil › Erweitert): how many records each club has here, how many of
  // them are still on their way and when relays last answered. Ids are cut short; nothing of the
  // content.
  addDiagnostics(async () => {
    const [{ storedClubs }, { waitingEvents }] = await Promise.all([
      import("@/lib/clubs/store"),
      import("@/lib/clubs/send"),
    ]);
    const clubs = await storedClubs();
    if (clubs.length === 0) return null;
    return {
      title: "Clubs",
      lines: await Promise.all(
        clubs.map(
          async (c) =>
            `${c.club.slice(0, 8)}: ${c.events.length} records, ${await waitingEvents(c.club)} waiting, loaded ${c.loadedAt ? new Date(c.loadedAt).toISOString() : "never"}`,
        ),
      ),
    };
  });
}
