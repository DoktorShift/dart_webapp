"use client"

import "./globals.css"
import { FallbackScreen } from "@/components/fallback-screen"
import { I18nProvider, useT } from "@/components/i18n-provider"
import { saveMatch } from "@/lib/game/storage"

function Message({ reset }: { reset: () => void }) {
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

// Last line of defence when even the app shell fails: same calm screen, its own document.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="de">
      <body>
        <I18nProvider>
          <Message reset={reset} />
        </I18nProvider>
      </body>
    </html>
  )
}
