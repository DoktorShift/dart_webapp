/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint and type errors fail the build (ESLint config: eslint.config.mjs).
  images: { unoptimized: true },
  // nostr-core 1.0.4 has no "sideEffects" field; this lets its lazily loaded chunk shrink from
  // 55 to 22 KB gzip without touching the guest path (docs/implementation/evidence/P0.03/CORE.md).
  experimental: { optimizePackageImports: ["nostr-core"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
