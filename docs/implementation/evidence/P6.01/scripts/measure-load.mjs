// Load measurement for the tournament engine (P6.01): 128 participants, 16 boards.
// Run from the repository root: node docs/implementation/evidence/P6.01/scripts/measure-load.mjs
// Wall-clock times (performance.now) of the pure engine in Node, without any screen. Every state
// change is followed by resolveTournament(), as a screen would do. With --cpu: processor time of
// this thread instead, for a busy machine where wall-clock times say more about the other work.
import { createTournament, recordResult, resolveTournament, startMatch, suggestBoards } from "../../../../../lib/tournaments/engine.ts"

const field = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Spieler ${i + 1}` }))
const boards = Array.from({ length: 16 }, (_, i) => `B${i + 1}`)
const setups = [
  ["Einzel-K.-o., 128", 128, { format: "single" }],
  ["Doppel-K.-o., 128", 128, { format: "double" }],
  ["Gruppen 32 × 4, dann K.-o., 128", 128, { format: "groups", groups: { count: 32, advance: 2 } }],
  ["Gruppen 2 × 64, dann K.-o., 128", 128, { format: "groups", groups: { count: 2, advance: 4 } }],
  ["Jeder gegen jeden, 64", 64, { format: "roundRobin" }],
]
const cpu = process.argv.includes("--cpu")
const now = cpu
  ? () => {
      const used = process.threadCpuUsage()
      return (used.user + used.system) / 1000
    }
  : () => performance.now()
const timed = (fn) => {
  const start = now()
  fn()
  return now() - start
}
const q = (list, p) => [...list].sort((a, b) => a - b)[Math.floor(p * (list.length - 1))].toFixed(1)

console.log(`Node ${process.version}, ${process.platform} ${process.arch}, ${cpu ? "Prozessorzeit" : "Wanduhr"}`)
console.log("| Format | Spiele | Auslosung kalt / warm (ms) | Aufrufe p50 / p99 / max (ms) | Ergebnisse p50 / p99 / max (ms) | Ergebnisse gesamt |")
console.log("| --- | --- | --- | --- | --- | --- |")
for (const [label, n, setup] of setups) {
  let t
  const make = () => {
    t = createTournament({ participants: field(n), seed: "last", rules: { legsToWin: 3 }, ...setup })
    resolveTournament(t)
  }
  const cold = timed(make)
  const warm = Math.min(timed(make), timed(make), timed(make))
  const calls = []
  const results = []
  for (;;) {
    for (const c of suggestBoards(resolveTournament(t), boards))
      calls.push(
        timed(() => {
          t = startMatch(t, c.match, c.board)
          resolveTournament(t)
        }),
      )
    const live = resolveTournament(t).matches.filter((m) => m.state === "live")
    if (live.length === 0) break
    for (const m of live)
      results.push(
        timed(() => {
          t = recordResult(t, m.id, { legs: [3, results.length % 3] })
          resolveTournament(t)
        }),
      )
  }
  const done = resolveTournament(t)
  if (!done.complete || !done.champion) throw new Error(`${label}: not complete`)
  console.log(
    `| ${label} | ${t.matches.length} | ${cold.toFixed(1)} / ${warm.toFixed(1)} | ${q(calls, 0.5)} / ${q(calls, 0.99)} / ${q(calls, 1)} | ${q(results, 0.5)} / ${q(results, 0.99)} / ${q(results, 1)} | ${results.length} |`,
  )
}
