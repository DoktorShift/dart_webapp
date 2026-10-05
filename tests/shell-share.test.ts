import { test } from "node:test"
import assert from "node:assert/strict"
import { copyText, shareLink, type ShareData } from "../lib/shell/share.ts"

const link: ShareData = { url: "https://blueline21.netlify.app/#club=c1", title: "Club" }

function clipboard(fail = false) {
  const written: string[] = []
  return {
    written,
    clipboard: {
      writeText: async (text: string) => {
        if (fail) throw new Error("NotAllowedError")
        written.push(text)
      },
    },
  }
}

test("the share sheet is used where it exists", async () => {
  const shared: ShareData[] = []
  const outcome = await shareLink(link, {}, { navigator: { share: async (d) => void shared.push(d) } })
  assert.equal(outcome, "shared")
  assert.deepEqual(shared, [link])
})

test("closing the share sheet is not an error and copies nothing", async () => {
  const board = clipboard()
  const abort = Object.assign(new Error("closed"), { name: "AbortError" })
  const outcome = await shareLink(link, {}, { navigator: { share: async () => Promise.reject(abort), ...board } })
  assert.equal(outcome, "dismissed")
  assert.deepEqual(board.written, [])
})

test("without a share sheet, or when it is refused, the link is copied", async () => {
  const a = clipboard()
  assert.equal(await shareLink(link, {}, { navigator: { ...a } }), "copied")
  assert.deepEqual(a.written, [link.url])

  const b = clipboard()
  const refused = Object.assign(new Error("no"), { name: "NotAllowedError" })
  assert.equal(await shareLink(link, {}, { navigator: { share: async () => Promise.reject(refused), ...b } }), "copied")

  const c = clipboard()
  assert.equal(await shareLink(link, { copy: true }, { navigator: { share: async () => assert.fail("must copy"), ...c } }), "copied")
})

test("a link the share sheet can't take is copied", async () => {
  const board = clipboard()
  const outcome = await shareLink(link, {}, { navigator: { share: async () => assert.fail(), canShare: () => false, ...board } })
  assert.equal(outcome, "copied")
})

test("copying falls back to a hidden text field, and reports failure honestly", async () => {
  let appended = 0
  let removed = 0
  const doc = (works: boolean) => ({
    createElement: () => ({ value: "", setAttribute() {}, style: {}, select() {} }) as unknown as HTMLTextAreaElement,
    body: { appendChild: () => appended++, removeChild: () => removed++ },
    execCommand: () => works,
  })
  assert.equal(await copyText("x", { navigator: { ...clipboard(true) }, document: doc(true) }), true)
  assert.equal(await copyText("x", { navigator: {}, document: doc(false) }), false)
  assert.equal(appended, removed, "the text field is always removed again")
  assert.equal(await copyText("x", {}), false)
})
