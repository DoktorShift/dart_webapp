"use client"

import { FallbackScreen } from "@/components/fallback-screen"
import { useT } from "@/components/i18n-provider"
import { SITE } from "@/lib/site"

// A wrong or old link lands here instead of a bare 404.
export default function NotFound() {
  const t = useT()
  return (
    <FallbackScreen
      title={t.fallback.notFoundTitle}
      message={t.fallback.notFoundMessage}
      actions={[{ label: t.fallback.goTo(SITE.name), onClick: () => window.location.assign("/"), primary: true }]}
    />
  )
}
