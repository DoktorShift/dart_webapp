// Static file server for the render pages (ES modules need http://, not file://).
import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".wav": "audio/wav", ".css": "text/css",
}

export function serve(root, port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname)
    const file = path.join(root, url)
    if (!file.startsWith(root)) return res.writeHead(403).end()
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return res.writeHead(404).end()
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" })
      fs.createReadStream(file).pipe(res)
    })
  })
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })))
}
