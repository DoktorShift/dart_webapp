"use client"

import { FallbackScreen } from "@/components/fallback-screen"
import { useT } from "@/components/i18n-provider"
import { saveMatch } from "@/lib/game/storage"

// Shown instead of a raw error if the app ever fails to draw. The game in progress is saved
// after every dart, so trying again usually picks up exactly where it stopped. If the saved game
// itself is the problem, starting a new game clears only that game, never the leaderboard.
export default function AppError({ reset }: { reset: () => void }) {
  const t = useT()
  return (
    <FallbackScreen
      title={t.fallback.errorTitle}
      message={t.fallback.errorMessage}
      actions={[
        { label: t.fallback.backToGame, onClick: reset, primary: true },
        {
          label: t.fallback.newGame,
          onClick: () => {
            saveMatch(null)
            window.location.assign("/")
          },
        },
      ]}
    />
  )
}
