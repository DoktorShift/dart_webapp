// Service worker: makes the installed app open and work without a connection.
//
// - Pages: network first, so a new version shows as soon as it is online; the last
//   copy of each page is used when offline.
// - Build assets (/_next/static, hashed names), icons and the manifest: cache first.
//
// Bump VERSION to drop everything cached by older versions of this file.
const VERSION = "v2"
const SHELL_CACHE = `shell-${VERSION}`
const ASSET_CACHE = `assets-${VERSION}`
const MAX_ASSETS = 150
const SHELL = ["/", "/about", "/manifest.webmanifest", "/icon/192", "/icon/512", "/apple-icon"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request))
  } else if (isStatic(url.pathname)) {
    event.respondWith(cacheFirst(request))
  }
})

const isStatic = (path) =>
  path.startsWith("/_next/static/") || path.startsWith("/icon/") || path === "/apple-icon" || path === "/manifest.webmanifest"

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  // Each page is kept under its own path (the scorer at "/", the About page at "/about").
  const key = new URL(request.url).pathname
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(key, response.clone())
    return response
  } catch {
    // Offline: the page itself if it was seen before, otherwise the scorer.
    return (await cache.match(key)) ?? (await cache.match("/")) ?? Response.error()
  }
}

async function cacheFirst(request) {
  // Icons are linked with a version query (?abc123); the files themselves don't change.
  const cached = await caches.match(request, { ignoreSearch: true })
  if (cached) return cached
  const cache = await caches.open(ASSET_CACHE)
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    trim(cache)
  }
  return response
}

// Old build assets pile up across deploys; keep the newest MAX_ASSETS.
async function trim(cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)))
}
