"use client"

import "./globals.css"
import AppError from "./error"
import { I18nProvider } from "@/components/i18n-provider"

// Last line of defence when even the app shell fails: same calm screen, its own document.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="de">
      <body>
        <I18nProvider>
          <AppError reset={reset} />
        </I18nProvider>
      </body>
    </html>
  )
}
