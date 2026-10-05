// Local Nostr infrastructure for the integration tests in tests/relay/ (npm run test:relay), all
// from nak, the nostr army knife: an in-memory relay ("nak serve"), a NIP-46 remote signer
// ("nak bunker") and nak's own implementations of NIP-44, NIP-59 and NIP-49 for interop checks.
// Everything stays on 127.0.0.1 with throwaway keys; nothing touches public relays.
//
// nak keeps state in ~/.config/nak (the bunker's control socket among it). Each bunker gets its
// own temporary HOME, so tests never touch the user's real nak configuration.
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const NAK = process.env.NAK_BIN ?? "/opt/homebrew/bin/nak"

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))))
    })
  })
}

async function waitForPort(port: number, child: ChildProcess, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`nak exited with ${child.exitCode}`)
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, "127.0.0.1")
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
    })
    if (open) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`nothing listens on ${port}`)
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once("exit", () => resolve())
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 2000).unref()
  })
}

export interface NakRelay {
  url: string
  port: number
  output: () => string
  stop: () => Promise<void>
}

// An empty in-memory relay. `auth` requires NIP-42 for everything; `port` reuses a port (to
// simulate a relay restart).
export async function startRelay(options: { auth?: boolean; port?: number } = {}): Promise<NakRelay> {
  const port = options.port ?? (await freePort())
  const args = ["serve", "--hostname", "127.0.0.1", "--port", String(port), ...(options.auth ? ["--auth"] : [])]
  const child = spawn(NAK, args, { stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout?.on("data", (chunk) => (log += chunk))
  child.stderr?.on("data", (chunk) => (log += chunk))
  await waitForPort(port, child)
  return { url: `ws://127.0.0.1:${port}`, port, output: () => log, stop: () => stopProcess(child) }
}

// Runs a nak command and returns its standard output, trimmed.
export function runNak(args: string[], options: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(NAK, args, { env: { ...process.env, ...options.env }, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`nak ${args[0]} failed: ${stderr || error.message}`))
      else resolve(stdout.trim())
    })
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })
}

export interface NakBunker {
  // bunker:// link with a single-use secret.
  uri: string
  // The user key the bunker signs with.
  pubkey: string
  secretKey: string
  output: () => string
  // Hands a nostrconnect:// link to the running bunker (what scanning the QR code does).
  connect: (nostrconnectUri: string) => Promise<void>
  stop: () => Promise<void>
}

export async function startBunker(relayUrl: string): Promise<NakBunker> {
  const home = mkdtempSync(join(tmpdir(), "nak-"))
  const secretKey = await runNak(["key", "generate"])
  const child = spawn(NAK, ["bunker", "--sec", secretKey, relayUrl], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } })
  let log = ""
  const ready = new Promise<{ uri: string; pubkey: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bunker did not start:\n${log}`)), 10_000)
    const onData = (chunk: Buffer) => {
      log += chunk
      const uri = /bunker:\s*(bunker:\/\/\S+)/.exec(log)?.[1]
      const pubkey = /pubkey:\s*([0-9a-f]{64})/.exec(log)?.[1]
      if (uri && pubkey) {
        clearTimeout(timer)
        resolve({ uri, pubkey })
      }
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.once("exit", (code) => reject(new Error(`bunker exited with ${code}:\n${log}`)))
  })
  const { uri, pubkey } = await ready
  return {
    uri,
    pubkey,
    secretKey,
    output: () => log,
    connect: async (nostrconnectUri) => {
      await runNak(["bunker", "connect", nostrconnectUri], { env: { HOME: home } })
    },
    stop: async () => {
      await stopProcess(child)
      rmSync(home, { recursive: true, force: true })
    },
  }
}
