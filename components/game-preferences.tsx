"use client"

import { SwitchRow } from "@/components/ui/group"
import { useT } from "@/components/i18n-provider"
import { speak } from "@/lib/feedback"
import type { AppSettings } from "@/lib/game/storage"

// The switches that change how a game sounds and asks: in Settings and in the game's options.
export function GamePreferences({
  settings,
  onSettingsChange,
  showAskAtDouble,
}: {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  showAskAtDouble: boolean
}) {
  const t = useT()
  return (
    <>
      {showAskAtDouble && (
        <SwitchRow
          title={t.preferences.askAtDouble}
          hint={t.preferences.askAtDoubleHint}
          checked={settings.askAtDouble}
          onCheckedChange={(askAtDouble) => onSettingsChange({ ...settings, askAtDouble })}
        />
      )}
      <SwitchRow
        title={t.preferences.sounds}
        hint={t.preferences.soundsHint}
        checked={settings.sound}
        onCheckedChange={(sound) => onSettingsChange({ ...settings, sound })}
      />
      <SwitchRow
        title={t.preferences.caller}
        hint={t.preferences.callerHint}
        checked={settings.caller}
        onCheckedChange={(caller) => {
          onSettingsChange({ ...settings, caller })
          if (caller) speak("Game on")
        }}
      />
    </>
  )
}
