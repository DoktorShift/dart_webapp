import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/lib/site"

// Everything is public: search engines and AI assistants are welcome to read it all.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
