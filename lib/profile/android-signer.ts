import type { Nip55Request } from "../nostr/ext/nip55.ts"
import type { Signer, VerifiedEvent } from "../nostr/types.ts"
import { dbGet, dbWrite, onStorageChange, type Keyed } from "../storage/db.ts"
import { SIGNER_PENDING_PREFIX } from "./session.ts"

// An Android signer app (NIP-55) from a web page. A request leaves the page as a nostrsigner:
// link; the answer comes back as a new address of the app (/#signer-return…), in the same tab or
// a new one, maybe after a reload. So every request is stored before the page is left, and the
// answer is matched to it by the link handler (completeAnswer), wherever it arrives. A signature
// asked for in one tab and answered in another reaches the waiting tab through the database.
//
// Only reading the key and occasional signatures (decision 0002 §4): decryption would put
// plaintext into the page address, so this signer has no NIP-44. Private lists then stay
// unreadable, and writing over them is refused (lib/nostr/ext/lists.ts).

// Approvals asked for at sign-in, so the signer app can answer later requests on its own.
const PERMISSIONS = [0, 10002, 30000, 31180].map((kind) => ({ type: "sign_event", kind }))
// The signer app has this long to answer; after that an answer is not taken (matchPending).
const ANSWER_WAIT_MS = 15 * 60 * 1000

interface PendingRequest {
  id: string
  request: Nip55Request
  // Set when the answer arrived, for a tab still waiting for it.
  answer?: { event: VerifiedEvent } | { refused: true }
}

// Requests this page is waiting for (signEvent below).
const waiting = new Set<string>()

const pendingId = (requestId: string) => `${SIGNER_PENDING_PREFIX}${requestId}`

const callbackUrl = () => `${window.location.origin}/#signer-return`

async function store(request: Nip55Request) {
  await dbWrite([{ store: "pending", put: { id: pendingId(request.id), request } satisfies PendingRequest as Keyed }])
}

// Sign-in: a stored request for the key, and the link the person taps to ask the signer app.
// (A link, because browsers open other apps only from a tap.)
export async function preparePublicKeyRequest(): Promise<string> {
  const nip55 = await import("../nostr/ext/nip55.ts")
  const request = nip55.createGetPublicKeyRequest()
  await store(request)
  return nip55.buildSignerUrl(request, { callbackUrl: callbackUrl(), permissions: PERMISSIONS })
}

function waitForAnswer(requestId: string): Promise<VerifiedEvent> {
  const id = pendingId(requestId)
  waiting.add(requestId)
  return new Promise<VerifiedEvent>((resolve, reject) => {
    const finish = async (result: () => void) => {
      stop()
      clearTimeout(timer)
      waiting.delete(requestId)
      await dbWrite([{ store: "pending", delete: id }]).catch(() => {})
      result()
    }
    const check = async () => {
      const pending = await dbGet<PendingRequest>("pending", id).catch(() => undefined)
      const answer = pending?.answer
      if (!answer) return
      const { SignerError } = await import("../nostr/signers.ts")
      void finish(() => ("event" in answer ? resolve(answer.event) : reject(new SignerError("rejected", "the signer app declined"))))
    }
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("pending")) void check()
    })
    const timer = setTimeout(async () => {
      const { SignerError } = await import("../nostr/signers.ts")
      void finish(() => reject(new SignerError("unknown", "no answer from the signer app")))
    }, ANSWER_WAIT_MS)
  })
}

// The signer of an Android signer session. signEvent stores the request and opens the signer
// app; it settles when the answer comes back (or after 15 minutes as "unknown").
export async function androidSigner(pubkey: string): Promise<Signer> {
  const { verifyingSigner } = await import("../nostr/signers.ts")
  const inner: Signer = {
    getPublicKey: async () => pubkey,
    async signEvent(template) {
      const nip55 = await import("../nostr/ext/nip55.ts")
      const request = nip55.createSignEventRequest(template, pubkey)
      await store(request)
      const answer = waitForAnswer(request.id)
      window.location.assign(nip55.buildSignerUrl(request, { callbackUrl: callbackUrl() }))
      return answer
    },
  }
  return verifyingSigner(inner, pubkey, { nip44: false, nip04: false })
}

export type SignerAnswer =
  | { type: "pubkey"; pubkey: string }
  // `awaited`: a signEvent in this page is waiting for it and takes it from here.
  | { type: "signed"; event: VerifiedEvent; awaited: boolean }
  | { type: "refused" }

// Takes the answer of /#signer-return… (the link payload after "signer-return"). Null when it
// answers nothing stored here: an old link from the history, or one answered already.
export async function completeAnswer(payload: string): Promise<SignerAnswer | null> {
  const nip55 = await import("../nostr/ext/nip55.ts")
  let callback: ReturnType<typeof nip55.parseCallback>
  try {
    callback = nip55.parseCallback(`#signer-return${payload}`)
  } catch {
    return null
  }
  if (!callback) return null
  const id = pendingId(callback.id)
  const pending = await dbGet<PendingRequest>("pending", id)
  if (!pending || pending.answer) return null
  try {
    const request = nip55.matchPending([pending.request], callback)
    if (request.type === "get_public_key") {
      const pubkey = await nip55.completeGetPublicKey(request, callback)
      await dbWrite([{ store: "pending", delete: id }])
      return { type: "pubkey", pubkey }
    }
    const event = await nip55.completeSignEvent(request, callback)
    await dbWrite([{ store: "pending", put: { ...pending, answer: { event } } as Keyed }])
    return { type: "signed", event, awaited: waiting.has(callback.id) }
  } catch (error) {
    // Declined, too old, or not what was asked for: the request is over either way.
    const refused = (error as { code?: string }).code === "rejected"
    await dbWrite([pending.request.type === "sign_event" && refused ? { store: "pending", put: { ...pending, answer: { refused: true } } as Keyed } : { store: "pending", delete: id }])
    return refused ? { type: "refused" } : null
  }
}
