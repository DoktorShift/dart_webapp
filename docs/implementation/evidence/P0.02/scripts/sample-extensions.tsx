"use client"

// P0.02 review round 1: sample registrations that use the shell's extension points the way an
// area would (an action that opens game setup from Clubs, two setup extras of which one throws,
// two result pieces, one game menu item). Not part of the app. For review1-checks.mjs, copy it into
// a scratch copy of the branch as components/shell/zz-sample-extensions.tsx, add
//   import "@/components/shell/zz-sample-extensions"
// to components/shell/extensions.ts there, build and start it (EXT in review1-checks.mjs).
import { Radio } from "lucide-react"
import { Group, SwitchRow } from "@/components/ui/group"
import { registerAction, registerGameMenuItem, registerSlotItem, type FinishedMatch, type SetupExtraProps } from "@/lib/shell/registry"

registerAction("club.create", (nav) => nav.openSetup("x01"))

function TestExtra({ config, value, onChange }: SetupExtraProps) {
  return (
    <Group title="Testbereich" footer={`Spieler: ${config.players.length}, Wert: ${JSON.stringify(value ?? null)}`}>
      <SwitchRow title="Testoption" checked={value === true} onCheckedChange={(on) => onChange(on ? true : undefined)} />
    </Group>
  )
}
function Boom(): never {
  throw new Error("boom piece")
}
registerSlotItem("setup.extras", "test", TestExtra)
registerSlotItem("setup.extras", "boom", Boom)

function TestCard({ match }: { match: FinishedMatch }) {
  return (
    <div data-testid="test-card" className="rounded-xl border border-border bg-card px-3 py-2 text-[0.9375rem]">
      Testkarte: {match.players[match.winner].name} gewinnt, {match.solo ? "solo" : `${match.players.length} Spieler`}, {match.throws.length} Würfe, Extras {JSON.stringify(match.config.extras ?? null)}
    </div>
  )
}
function TestButton() {
  return <button type="button" data-testid="test-button" className="h-11 rounded-xl border border-border text-[0.9375rem]">Zweites Teil</button>
}
registerSlotItem("result.actions", "test", TestCard)
registerSlotItem("result.actions", "test2", TestButton)

registerGameMenuItem({
  id: "test",
  label: () => "Testeintrag",
  icon: Radio,
  onSelect: ({ match }) => {
    ;(window as unknown as { __menu?: string }).__menu = `${match.id}|${match.throws.length}|${JSON.stringify(match.config.extras ?? null)}`
  },
})
