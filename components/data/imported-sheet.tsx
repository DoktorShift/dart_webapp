"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useT } from "@/components/i18n-provider"
import { formatDate } from "@/lib/i18n"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { assignImportedName, nameKey, type PlayerRecord } from "@/lib/storage/players"
import type { Standing } from "@/lib/storage/stats"

// Results from version 1.0.0 know only names. Here the players decide, on purpose, that the
// games saved as "Anna" belong to the Anna of this version, or separate them again. Nothing is
// ever merged automatically: two people can share a name.

const importedGames = (matches: ArchivedMatch[], keys: string[]) =>
  matches.filter((m) => m.source === "imported-v1" && m.players.some((p) => !p.unnamed && keys.includes(nameKey(p.name)))).length

export function ImportedSheet({
  standing,
  matches,
  players,
  onClose,
}: {
  // An imported row, or a player's row that counts imported games; null when closed.
  standing: Standing | null
  matches: ArchivedMatch[]
  players: PlayerRecord[]
  onClose: () => void
}) {
  const t = useT()
  const d = t.data
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const close = () => {
    setFailed(false)
    onClose()
  }

  const run = async (change: () => Promise<unknown>) => {
    setBusy(true)
    setFailed(false)
    try {
      if ((await change()) === false) throw new Error("not assigned")
      close()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const name = standing?.name ?? ""
  const imported = standing?.imported ?? false
  const key = imported && standing ? standing.key.slice(standing.key.indexOf(":") + 1) : ""
  const owner = !imported && standing ? players.find((p) => p.id === standing.playerId) : undefined
  const ownedNames = owner?.importedNames ?? []
  const candidates = players
    .filter((p) => p.nameKey === key)
    .sort((a, b) => (Date.parse(b.lastPlayedAt ?? b.updatedAt) || 0) - (Date.parse(a.lastPlayedAt ?? a.updatedAt) || 0))
  const when = (p: PlayerRecord) =>
    formatDate(t, new Date(p.lastPlayedAt ?? p.updatedAt).getTime())

  const count = importedGames(matches, imported ? [key] : ownedNames)
  const title = imported ? d.importedTitle(name) : d.mergedTitle(name)
  const description = imported ? d.importedText(count) : d.mergedText(name, count)

  return (
    <Sheet open={standing !== null} onOpenChange={(open) => !open && close()} title={title} description={description}>
      <div className="flex flex-col gap-3 pb-2">
        {imported && candidates.length === 0 && <p className="text-[0.9375rem] text-muted-foreground">{d.assignNobody(name, count)}</p>}

        {imported && candidates.length === 1 && (
          <Button
            onClick={() => void run(() => assignImportedName(key, candidates[0].id))}
            disabled={busy}
            className="h-12 w-full whitespace-normal rounded-xl text-[1.0625rem] font-semibold"
          >
            {d.assignTo(candidates[0].name)}
          </Button>
        )}

        {imported && candidates.length > 1 && (
          <>
            <p className="text-[0.9375rem] text-muted-foreground">{d.assignChoose}</p>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {candidates.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => assignImportedName(key, p.id))}
                    className="flex min-h-14 w-full flex-col justify-center px-4 py-2 text-left active:bg-secondary/70 disabled:opacity-40"
                  >
                    <span className="text-[1.0625rem] text-primary [overflow-wrap:anywhere]">{d.assignTo(p.name)}</span>
                    <span className="text-[0.8125rem] text-muted-foreground">{d.lastPlayed(when(p))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {imported && candidates.length > 0 && <p className="text-[0.8125rem] text-muted-foreground">{d.assignHint}</p>}

        {!imported && owner && (
          <Button
            variant="secondary"
            onClick={() => void run(async () => {
              for (const importedName of ownedNames) await assignImportedName(importedName, null)
            })}
            disabled={busy}
            className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold"
          >
            {d.separate}
          </Button>
        )}

        {failed && (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {d.assignFailed}
          </p>
        )}

        <Button variant="ghost" onClick={close} className="h-12 w-full rounded-xl text-[1.0625rem] text-primary">
          {imported && candidates.length > 0 ? t.common.cancel : t.common.done}
        </Button>
      </div>
    </Sheet>
  )
}
