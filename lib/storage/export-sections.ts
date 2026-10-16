// Sections other areas add to the device's data file (./data.ts): built when the file is made,
// handed back on import, by name. What a section holds is its area's business; the file keeps
// it as JSON under `sections`. Areas register at start (components/shell/extensions.ts) with
// builders that load their code on demand, so this module stays tiny.
//
//   registerExportSection("badges", { build: () => import("@/lib/badges/export").then((m) => m.buildBadgeSection()), apply: … })

export interface ExportSection {
  build(): Promise<unknown>
  // Takes the section back in; must cope with a file edited by hand, and with running twice.
  apply(value: unknown): Promise<void>
}

const sections = new Map<string, ExportSection>()

export function registerExportSection(name: string, section: ExportSection) {
  sections.set(name, section)
  return () => {
    if (sections.get(name) === section) sections.delete(name)
  }
}

export const exportSections = (): [string, ExportSection][] => [...sections]
