// "Diagnose kopieren" (Profil › Erweitert): a plain-text report to send along with a problem.
// Public facts only, never a secret key, a connection secret, a wallet connection or game data.
// The profile writes its part; other areas add theirs (the outbox, the last sync) here.

export interface DiagnosticsSection {
  title: string
  lines: string[]
}

type Source = () => DiagnosticsSection | null | Promise<DiagnosticsSection | null>

const sources = new Set<Source>()

export function addDiagnostics(source: Source) {
  sources.add(source)
  return () => {
    sources.delete(source)
  }
}

// The report: the given sections first, then every area's. A part that fails is left out.
export async function diagnosticsReport(sections: readonly DiagnosticsSection[]): Promise<string> {
  const added = await Promise.all(
    [...sources].map(async (source) => {
      try {
        return await source()
      } catch {
        return null
      }
    }),
  )
  return `${[...sections, ...added.filter((s): s is DiagnosticsSection => s !== null)].map((s) => [`## ${s.title}`, ...s.lines].join("\n")).join("\n\n")}\n`
}
