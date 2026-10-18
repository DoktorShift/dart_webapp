// NIP-49 off the main thread: runs ./nip49.ts in a Web Worker, so the page keeps responding
// during the scrypt run. Where no worker can start (old browsers, strict policies, Node), it
// falls back to the async variant on the main thread, which blocks the page for the run (about
// 0.3 s at log_n 16 on a desktop). To be upstreamed with ./nip49.ts.
import { decryptAsync, encryptAsync, Nip49Error, type Decrypted, type EncryptOptions, type Nip49ErrorCode } from "./nip49.ts"
import type { Nip49Request, Nip49Response } from "./nip49.worker.ts"

type Job = Nip49Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never

interface Waiting {
  resolve: (response: Nip49Response) => void
  reject: (error: Error) => void
}

// The worker itself failed (not the decryption): run the job on the main thread instead.
class WorkerUnavailable extends Error {}

let worker: Worker | null = null
let unavailable = false
let serial = 0
const waiting = new Map<number, Waiting>()

function startWorker(): Worker | null {
  if (unavailable || typeof Worker === "undefined") return null
  if (worker) return worker
  try {
    worker = new Worker(new URL("./nip49.worker.ts", import.meta.url), { type: "module" })
  } catch {
    unavailable = true
    return null
  }
  worker.onmessage = ({ data }: MessageEvent<Nip49Response>) => {
    const job = waiting.get(data.id)
    waiting.delete(data.id)
    job?.resolve(data)
  }
  worker.onerror = (event) => {
    event.preventDefault?.()
    unavailable = true
    worker?.terminate()
    worker = null
    for (const job of waiting.values()) job.reject(new WorkerUnavailable("worker failed"))
    waiting.clear()
  }
  return worker
}

function post(job: Job, transfer: Transferable[] = []): Promise<Nip49Response> | null {
  const running = startWorker()
  if (!running) return null
  const id = ++serial
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    running.postMessage({ ...job, id }, transfer)
  })
}

function failure(response: Extract<Nip49Response, { ok: false }>): Nip49Error {
  return new Nip49Error(response.code as Nip49ErrorCode, response.message)
}

export async function encryptOffThread(secretKey: Uint8Array, password: string, options: EncryptOptions = {}): Promise<string> {
  try {
    // A copy is moved to the worker (not cloned), so the caller's key stays usable and no
    // second copy lingers on this side.
    const copy = secretKey.slice()
    const pending = post({ op: "encrypt", secretKey: copy, password, options }, [copy.buffer])
    if (pending) {
      const response = await pending
      if (!response.ok) throw failure(response)
      if ("ncryptsec" in response) return response.ncryptsec
    }
  } catch (error) {
    if (!(error instanceof WorkerUnavailable)) throw error
  }
  return encryptAsync(secretKey, password, options)
}

export async function decryptOffThread(ncryptsec: string, password: string): Promise<Decrypted> {
  try {
    const pending = post({ op: "decrypt", ncryptsec, password })
    if (pending) {
      const response = await pending
      if (!response.ok) throw failure(response)
      if ("secretKey" in response) return { secretKey: response.secretKey, logN: response.logN, keySecurity: response.keySecurity }
    }
  } catch (error) {
    if (!(error instanceof WorkerUnavailable)) throw error
  }
  return decryptAsync(ncryptsec, password)
}

// True while jobs run in a worker (false after a fallback). For diagnostics only.
export const usesWorker = () => worker !== null && !unavailable
