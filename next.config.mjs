// What the page may load and talk to. Scripts and styles only from here (Next's own inline
// scripts and the motion libraries' inline styles need 'unsafe-inline'; development also needs
// eval for fast refresh), pictures from any https host (avatars, badges) plus the app's own
// canvas output, connections to https (NIP-05, LNURL) and secure relays, local relays only in
// development and tests. Nothing may embed this page, no plug-ins, no base override, forms stay here.
const dev = process.env.NODE_ENV === "development"
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint and type errors fail the build (ESLint config: eslint.config.mjs).
  images: { unoptimized: true },
  // nostr-core 1.0.6 has no "sideEffects" field; this lets its lazily loaded chunk shrink from
  // 55 to 22 KB gzip without touching the guest path (docs/implementation/evidence/P0.03/CORE.md).
  experimental: { optimizePackageImports: ["nostr-core"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The camera only for this site's own pages: the in-app QR scanner (invitations, and later
          // pairing and wallet codes). Microphone and location stay off.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
}

export default nextConfig
