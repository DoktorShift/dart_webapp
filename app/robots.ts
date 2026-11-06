import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/lib/site"

// Everything is public: search engines and AI assistants are welcome to read it all.
// Built once; also required for the static export of the iOS app (npm run build:ios).
export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
