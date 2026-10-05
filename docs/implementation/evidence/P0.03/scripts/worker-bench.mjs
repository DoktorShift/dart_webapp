// Memory-hard loop like scrypt's ROMix (64 MiB, random access), main thread vs dedicated worker,
// plus the app's own NIP-49 worker chunk called directly. Needs the probe route running (see
// measure.mjs). Usage: node worker-bench.mjs /_next/static/chunks/<nip49 worker chunk>.js [headed]
import { chromium } from "playwright"
const [workerChunk] = process.argv.slice(2)
const browser = await chromium.launch({ headless: process.argv[3] !== "headed" })
const page = await browser.newPage()
await page.goto("http://127.0.0.1:3202/nostr-probe")
const result = await page.evaluate(async (chunk) => {
  const work = `function work(){const N=1<<16,bs=256;const V=new Uint32Array(N*bs);const X=new Uint32Array(bs);for(let i=0;i<bs;i++)X[i]=i*7;for(let i=0;i<N;i++){V.set(X,i*bs);for(let k=0;k<bs;k++)X[k]=(X[k]*1664525+1013904223+X[(k+1)%bs])>>>0}for(let i=0;i<N;i++){const j=(X[0]&(N-1))*bs;for(let k=0;k<bs;k++)X[k]=(X[k]^V[j+k])*2654435761>>>0}return X[0]}`
  const t0 = performance.now()
  new Function(work + ";return work()")()
  const main = performance.now() - t0
  const blob = new Blob([work + ";onmessage=()=>{const t=performance.now();work();postMessage(performance.now()-t)}"], { type: "text/javascript" })
  const w = new Worker(URL.createObjectURL(blob))
  const inWorker = await new Promise((r) => { w.onmessage = (e) => r(e.data); w.postMessage(0) })
  // The app's NIP-49 worker, called directly.
  const app = new Worker(chunk)
  const t1 = performance.now()
  const reply = await new Promise((r) => { app.onmessage = (e) => r(e.data); app.postMessage({ id: 1, op: "encrypt", secretKey: new Uint8Array(32).fill(7), password: "x", options: { logN: 16 } }) })
  const appMs = performance.now() - t1
  const t2 = performance.now()
  await new Promise((r) => { app.onmessage = (e) => r(e.data); app.postMessage({ id: 2, op: "encrypt", secretKey: new Uint8Array(32).fill(7), password: "x", options: { logN: 12 } }) })
  const app12 = performance.now() - t2
  return { mainMs: Math.round(main), workerMs: Math.round(inWorker), appWorkerLogN16Ms: Math.round(appMs), appWorkerLogN12Ms: Math.round(app12), ok: reply.ok }
}, workerChunk)
console.log(JSON.stringify(result))
await browser.close()
