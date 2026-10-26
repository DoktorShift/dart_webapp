import { test } from "node:test"
import assert from "node:assert/strict"
import { acceptFriend, acceptReceived, askFriend, byState, EMPTY_FRIENDS, findFriend, friendsData, friendsOf, MAX_FRIENDS, removeFriend, removeReceived, requestReceived } from "../lib/friends/model.ts"

const A = "a".repeat(64)
const B = "b".repeat(64)
const key = (n: number) => n.toString(16).padStart(64, "0")

test("asking makes a sent entry and a request to send; asking twice changes nothing", () => {
  const first = askFriend(EMPTY_FRIENDS, A, 100, ["wss://r.example", "wss://s.example", "wss://t.example"])
  assert.equal(first.send, "request")
  assert.deepEqual(findFriend(first.friends, A), { pubkey: A, state: "sent", since: 100, relays: ["wss://r.example", "wss://s.example"] })
  assert.equal(first.friends.handled[A], 100)
  const again = askFriend(first.friends, A, 200)
  assert.equal(again.send, null)
  assert.equal(again.friends, first.friends, "the same object: nothing to write")
})

test("a request from someone I asked makes us friends, with an accept to send; the accept finishes a sent request", () => {
  const asked = askFriend(EMPTY_FRIENDS, A, 100).friends
  const crossed = requestReceived(asked, A, 150)
  assert.equal(crossed.send, "accept")
  assert.equal(findFriend(crossed.friends, A)?.state, "friend")
  const other = askFriend(EMPTY_FRIENDS, B, 100).friends
  assert.equal(findFriend(acceptReceived(other, B, 160).friends, B)?.state, "friend")
  // An accept from someone I never asked changes no entry.
  assert.deepEqual(acceptReceived(EMPTY_FRIENDS, B, 160).friends.entries, [])
})

test("a received request waits with its line; accepting answers it, asking the person back accepts too", () => {
  const got = requestReceived(EMPTY_FRIENDS, A, 100, "  Dienstags im Anker?  ")
  assert.equal(got.send, null)
  assert.deepEqual(findFriend(got.friends, A), { pubkey: A, state: "received", since: 100, message: "Dienstags im Anker?" })
  const accepted = acceptFriend(got.friends, A, 120)
  assert.equal(accepted.send, "accept")
  assert.deepEqual(findFriend(accepted.friends, A), { pubkey: A, state: "friend", since: 120 })
  const back = askFriend(got.friends, A, 130)
  assert.equal(back.send, "accept")
  assert.equal(findFriend(back.friends, A)?.state, "friend")
  assert.equal(acceptFriend(EMPTY_FRIENDS, B, 1).send, null)
})

test("removing tells the other side about a friendship or my own request, never about a declined one", () => {
  const friends = acceptFriend(requestReceived(EMPTY_FRIENDS, A, 1).friends, A, 2).friends
  assert.equal(removeFriend(friends, A, 3).send, "remove")
  assert.equal(removeFriend(askFriend(EMPTY_FRIENDS, B, 1).friends, B, 2).send, "remove")
  assert.equal(removeFriend(requestReceived(EMPTY_FRIENDS, B, 1).friends, B, 2).send, null)
  assert.equal(removeFriend(EMPTY_FRIENDS, B, 1).send, null)
  assert.deepEqual(removeReceived(friends, A, 5).friends.entries, [])
})

test("messages older than the last word about a person are stale: declines stick, a replayed remove can't undo a newer accept", () => {
  // A declines B's request at 10; the same request replays later.
  const declined = removeFriend(requestReceived(EMPTY_FRIENDS, B, 5).friends, B, 10).friends
  const replay = requestReceived(declined, B, 5)
  assert.equal(replay.friends, declined)
  // B asks again, later: shown.
  assert.equal(findFriend(requestReceived(declined, B, 20).friends, B)?.state, "received")
  // B removed A at 30, A asked again at 40, B accepted at 50; the old remove replays.
  let f = removeReceived(acceptFriend(requestReceived(EMPTY_FRIENDS, B, 1).friends, B, 2).friends, B, 30).friends
  f = acceptReceived(askFriend(f, B, 40).friends, B, 50).friends
  assert.equal(findFriend(f, B)?.state, "friend")
  assert.equal(removeReceived(f, B, 30).friends, f)
  // Ending a friendship at 60 keeps B's original request (1) from coming back.
  const ended = removeFriend(f, B, 60).friends
  assert.equal(requestReceived(ended, B, 1).friends, ended)
})

test("the same second counts, an exact replay does not: crossed requests in one second still meet, a repeated accept writes nothing", () => {
  // A asked B at 100; B's accept carries 100 too.
  const asked = askFriend(EMPTY_FRIENDS, B, 100).friends
  const met = acceptReceived(asked, B, 100).friends
  assert.equal(findFriend(met, B)?.state, "friend")
  assert.equal(acceptReceived(met, B, 100).friends, met)
  const got = requestReceived(EMPTY_FRIENDS, A, 50).friends
  assert.equal(requestReceived(got, A, 50).friends, got)
  // The other side's remove was the last word; its replay writes nothing either.
  const gone = removeReceived(met, B, 200).friends
  assert.equal(removeReceived(gone, B, 200).friends, gone)
})

test("the list is full at 500: a new request from either side is refused, known people still change", () => {
  let friends = EMPTY_FRIENDS
  for (let i = 1; i <= MAX_FRIENDS; i++) friends = askFriend(friends, key(i), i).friends
  assert.equal(friends.entries.length, MAX_FRIENDS)
  assert.equal(askFriend(friends, A, 1000).full, true)
  assert.equal(requestReceived(friends, A, 1000).full, true)
  assert.equal(findFriend(acceptReceived(friends, key(7), 1000).friends, key(7))?.state, "friend")
})

test("the record keeps only entries with the shape, one per person, remembers handled times, and writes them back", () => {
  const data = {
    friends: [
      { pubkey: A, state: "friend", since: 5, relays: ["wss://ok.example", "ws://no.example", 3], message: "" },
      { pubkey: A, state: "sent", since: 9 },
      { pubkey: "zz", state: "friend", since: 1 },
      { pubkey: B, state: "waiting", since: 1 },
      { pubkey: B, state: "received", since: "1" },
      null,
    ],
    handled: { [A]: 5, [B]: 7, zz: 1, [key(3)]: "x" },
  }
  const read = friendsOf(data)
  assert.deepEqual(read.entries, [{ pubkey: A, state: "friend", since: 5, relays: ["wss://ok.example"] }])
  assert.deepEqual(read.handled, { [A]: 5, [B]: 7 })
  assert.deepEqual(friendsData(read), { friends: read.entries, handled: read.handled })
  assert.deepEqual(friendsOf(null), EMPTY_FRIENDS)
  assert.deepEqual(friendsOf({ friends: "x" }), EMPTY_FRIENDS)
  assert.deepEqual(byState(requestReceived(read, B, 8).friends, "received").map((f) => f.pubkey), [B])
  // Known people beyond the cap of remembered times: the newest stay, entries always.
  const many = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [key(i + 1), i + 1]))
  const pruned = friendsOf({ friends: [{ pubkey: key(1), state: "friend", since: 1 }], handled: many })
  assert.equal(Object.keys(pruned.handled).length, 1000)
  assert.equal(pruned.handled[key(1)], 1)
  assert.equal(pruned.handled[key(1200)], 1200)
  assert.equal(pruned.handled[key(2)], undefined)
})
