"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { Share, SquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceRow, Group, LinkRow } from "@/components/ui/group"
import { Segmented } from "@/components/ui/segmented"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { GamePreferences } from "@/components/game-preferences"
import { useI18n, useT } from "@/components/i18n-provider"
import { useMatchHistory } from "@/lib/leaderboard"
import { useInstallApp, type InstallState } from "@/hooks/use-install-app"
import { LOCALES, type LocalePreference } from "@/lib/i18n"
import type { AppSettings } from "@/lib/game/storage"
import { SITE } from "@/lib/site"

// Installing to the home screen: one tap where the browser allows it, otherwise the steps.
function InstallRow({ state }: { state: InstallState | null }) {
  const t = useT()
  if (!state) return null
  if (state.kind === "installed") {
    return (
      <div className="flex min-h-12 items-center justify-between px-4">
        <span className="text-[1.0625rem]">{t.settings.homeScreenApp}</span>
        <span className="text-[1.0625rem] text-muted-foreground">{t.settings.installed}</span>
      </div>
    )
  }
  if (state.kind === "prompt") {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span>
          <span className="block text-[1.0625rem]">{t.settings.homeScreenApp}</span>
          <span className="block text-[0.8125rem] text-muted-foreground">{t.settings.installHint}</span>
        </span>
        <Button onClick={state.install} className="h-10 shrink-0 rounded-full px-5 text-[0.9375rem] font-semibold">
          {t.settings.install}
        </Button>
      </div>
    )
  }
  const [shareBefore, shareAfter] = t.settings.iosShare
  const [addBefore, addAfter] = t.settings.iosAdd
  return (
    <div className="px-4 py-3">
      <span className="block text-[1.0625rem]">{t.settings.homeScreenApp}</span>
      {state.kind === "ios" ? (
        <ol className="mt-1 space-y-1 text-[0.9375rem] text-muted-foreground">
          <li className="flex flex-wrap items-center gap-x-1.5">
            1. {shareBefore} <Share className="inline h-4 w-4 text-primary" aria-hidden="true" /> {shareAfter}
          </li>
          <li className="flex flex-wrap items-center gap-x-1.5">
            2. {addBefore} <SquarePlus className="inline h-4 w-4 text-primary" aria-hidden="true" /> {addAfter}
          </li>
        </ol>
      ) : (
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">{t.settings.manual}</p>
      )}
    </div>
  )
}

export function SettingsScreen({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (s: AppSettings) => void }) {
  const { t, preference, setPreference } = useI18n()
  const { theme, setTheme } = useTheme()
  const { matches, clear } = useMatchHistory()
  const [confirmReset, setConfirmReset] = useState(false)
  const install = useInstallApp()

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl px-4 pb-10 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-[max(env(safe-area-inset-top),0.5rem)] lg:pt-10">
        <h1 className="pt-3 font-display text-4xl font-semibold tracking-tight">{t.settings.title}</h1>

        <Group title={t.settings.duringGame}>
          <ChoiceRow
            title={t.settings.scoreEntry}
            hint={t.settings.scoreEntryHint}
            options={[
              { value: "dart", label: t.game.perDart },
              { value: "visit", label: t.game.perVisit },
            ]}
            value={settings.entryMode}
            onChange={(entryMode) => onSettingsChange({ ...settings, entryMode })}
          />
          <GamePreferences settings={settings} onSettingsChange={onSettingsChange} showAskAtDouble={settings.entryMode === "visit"} />
        </Group>

        <Group title={t.settings.app} footer={install?.kind === "installed" ? t.settings.appInstalledFooter : t.settings.appFooter}>
          <InstallRow state={install} />
          <LinkRow href="/about#install">{t.settings.guide}</LinkRow>
        </Group>

        <Group title={t.settings.language}>
          <div className="px-4 py-3">
            <Segmented<LocalePreference>
              label={t.settings.language}
              options={[{ value: "system", label: t.settings.languageSystem }, ...LOCALES.map(({ id, label }) => ({ value: id, label }))]}
              value={preference}
              onChange={setPreference}
            />
          </div>
        </Group>

        <Group title={t.settings.appearance}>
          <div className="px-4 py-3">
            <Segmented
              label={t.settings.appearance}
              options={[
                { value: "dark", label: t.settings.themes.dark },
                { value: "light", label: t.settings.themes.light },
                { value: "system", label: t.settings.themes.system },
              ]}
              value={theme}
              onChange={setTheme}
            />
          </div>
        </Group>

        <Group title={t.settings.leaderboard} footer={t.settings.leaderboardFooter}>
          <div className="flex min-h-12 items-center justify-between px-4">
            <span className="text-[1.0625rem]">{t.settings.savedGames}</span>
            <span className="text-[1.0625rem] tabular-nums text-muted-foreground">{matches.length}</span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={matches.length === 0}
            className="flex min-h-12 w-full items-center px-4 text-left text-[1.0625rem] text-danger active:bg-secondary/70 disabled:opacity-40"
          >
            {t.settings.reset}
          </button>
        </Group>

        <Group title={t.settings.about}>
          <LinkRow href="/about">{t.settings.aboutApp(SITE.name)}</LinkRow>
        </Group>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.settings.resetTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.settings.resetDescription(matches.length)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={clear} className="h-11 bg-danger text-white hover:bg-danger/90">
              {t.settings.resetConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
