// A second device for tests/relay/live.test.ts: its own memory, database and live boards, in a
// worker thread. It takes over a match from a handoff code and then scores it like a board.
import { parentPort, workerData } from "node:worker_threads"
import "../storage-helpers.ts"
import type { SavedMatch, Throw } from "../../lib/game/types.ts"
import { attachBoard, updateBoard } from "../../lib/live/board.ts"
import { takeHandoff } from "../../lib/live/handoff.ts"
import { decodeHandoffLink } from "../../lib/protocol/handoff.ts"
import { resumeOutbox } from "../../lib/sync/outbox.ts"

// Read whenever the live code picks its relays.
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = workerData.relay
// The outbox sends in this device as it does in the app from its start.
void resumeOutbox()

type Message = { type: "take"; code: string } | { type: "throw"; throws: Throw[] }

let game: SavedMatch | null = null

parentPort!.on("message", (message: Message) => {
  if (message.type === "take") {
    const control = takeHandoff(decodeHandoffLink(message.code), (take) => {
      if (take.step === "done") {
        game = take.game
        void attachBoard(take.game).then((live) => parentPort!.postMessage({ type: "taken", game: take.game, live }))
      } else parentPort!.postMessage({ type: "step", step: take.step, ...("checkCode" in take ? { checkCode: take.checkCode } : {}) })
    })
    control.take()
  } else if (message.type === "throw" && game) {
    game = { ...game, throws: message.throws }
    updateBoard(game)
  }
})

parentPort!.postMessage({ type: "ready" })
