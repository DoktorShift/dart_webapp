import { NAMES, ROUNDS, CHECKOUT, config501, throwLog, replay } from "./game.mjs"
const cfg = config501(NAMES)
const visitsBeforeLena4 = [...ROUNDS.slice(0, 3).flat(), ...ROUNDS[3].slice(0, 4)]
const s1 = replay(cfg, throwLog(cfg, visitsBeforeLena4))
console.log("late segment start: current", NAMES[s1.current], "scores", s1.scores.join(" "))
const all = replay(cfg, throwLog(cfg, [...ROUNDS.flat(), CHECKOUT]))
console.log("winner", NAMES[all.winner], "scores", all.scores.join(" "))
for (const [i, st] of all.stats.entries()) console.log(NAMES[i].padEnd(6), "darts", st.darts, "avg", (st.points / st.darts * 3).toFixed(1))
