"use client"

import { useState } from "react"
import { FileJson, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { monthYear } from "@/components/profile/format"
import { useProfileGames, type OwnProfile } from "@/components/profile/use-profile"
import { modeName } from "@/lib/i18n"
import { historyCsv, historyFileName, historyJson } from "@/lib/profile/export"
import { saveFile } from "@/lib/save-file"
import { offersFileShare, shareFile } from "@/lib/shell/share-file"

// Profil › Konto › Spielverlauf: the profile's games as a file, through the share sheet (Apple
// Health: export from the profile, off the main path). One sentence says what goes out, two
// rows say what each file is for. Nothing leaves without this tap.
export function HistorySheet({ own, open, onOpenChange }: { own: OwnProfile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const h = tx.history
  const games = useProfileGames(own)
  const [failed, setFailed] = useState(false)
  const oldest = games.length > 0 ? Math.min(...games.map((g) => Date.parse(g.match.finishedAt) || Date.now())) : null

  // The file is built right in the tap, so the share sheet opens within it.
  const share = (extension: "csv" | "json") => {
    setFailed(false)
    try {
      const name = historyFileName(h.fileName, extension)
      const labels = { columns: h.columns, won: h.won, lost: h.lost, training: h.training, imported: h.imported, local: h.local, mode: (m: { modeId: string; modeName: string }) => modeName(t, m.modeId, m.modeName) }
      const file =
        extension === "csv" ?
          new File([historyCsv(games, labels)], name, { type: "text/csv" })
        : new File([JSON.stringify(historyJson(games), null, 2)], name, { type: "application/json" })
      if (offersFileShare(file)) {
        void shareFile(file).then((shared) => {
          if (shared === "blocked" || shared === "failed") saveFile(file, name)
        })
      } else saveFile(file, name)
    } catch {
      setFailed(true)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={h.title}>
      <SheetBody>
        <p className="text-[1.0625rem] leading-snug text-muted-foreground">{oldest === null ? h.none : h.intro(games.length, monthYear(t, oldest))}</p>
        <div className="mt-4 grid gap-2">
          <ExportButton icon={FileSpreadsheet} title={h.csv} hint={h.csvHint} disabled={games.length === 0} onClick={() => share("csv")} />
          <ExportButton icon={FileJson} title={h.json} hint={h.jsonHint} disabled={games.length === 0} onClick={() => share("json")} />
        </div>
        {failed && (
          <InlineStatus tone="error" className="mt-3">
            {h.failed}
          </InlineStatus>
        )}
        <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{h.hint}</p>
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-3 h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </SheetBody>
    </Sheet>
  )
}

// One export as a row: what the file is and whom it is for, the format in brackets.
function ExportButton({ icon: Icon, title, hint, disabled, onClick }: { icon: typeof FileJson; title: string; hint: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-secondary px-4 py-2 text-left transition-colors active:bg-secondary/70 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[1.0625rem] font-medium leading-snug">{title}</span>
        <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
