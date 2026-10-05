// Web Worker entry for NIP-49, started by ./nip49.offthread.ts so scrypt never blocks the page.
// To be upstreamed to nostr-core together with ./nip49.ts.
import { decryptAsync, encryptAsync, Nip49Error, type EncryptOptions, type KeySecurity } from "./nip49.ts"

export type Nip49Request =
  | { id: number; op: "encrypt"; secretKey: Uint8Array; password: string; options?: EncryptOptions }
  | { id: number; op: "decrypt"; ncryptsec: string; password: string }

export type Nip49Response =
  | { id: number; ok: true; ncryptsec: string }
  | { id: number; ok: true; secretKey: Uint8Array; logN: number; keySecurity: KeySecurity }
  | { id: number; ok: false; code: string; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<Nip49Request>) => void | Promise<void>) | null
  postMessage(message: Nip49Response, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

// The async variants on purpose, although nothing else runs here: in Chromium the synchronous
// scrypt ran about ten times slower inside a worker than the async one (3.1 s against 0.3 s at
// log_n 16, evidence/P0.03/CORE.md); its single long loop seems to stay unoptimized there.
scope.onmessage = async ({ data }) => {
  try {
    if (data.op === "encrypt") {
      scope.postMessage({ id: data.id, ok: true, ncryptsec: await encryptAsync(data.secretKey, data.password, data.options) })
    } else {
      const { secretKey, logN, keySecurity } = await decryptAsync(data.ncryptsec, data.password)
      scope.postMessage({ id: data.id, ok: true, secretKey, logN, keySecurity }, [secretKey.buffer])
    }
  } catch (error) {
    const code = error instanceof Nip49Error ? error.code : "malformed"
    scope.postMessage({ id: data.id, ok: false, code, message: error instanceof Error ? error.message : String(error) })
  }
}
