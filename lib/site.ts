// The app's name, address and author. Everything worded (titles, descriptions, the freelance
// note) is in the language catalogs, lib/i18n.

// Netlify sets URL during builds (the custom domain once there is one). SITE_URL overrides it.
const url = (process.env.SITE_URL ?? process.env.URL ?? "https://blueline21.netlify.app").replace(/\/+$/, "")

export const SITE = {
  name: "BlueLine Darts",
  // The label under the home-screen icon; iOS shortens anything much longer.
  shortName: "BlueLine",
  url,
  author: { name: "DrShift", url: "https://github.com/DoktorShift" },
  source: "https://github.com/DoktorShift/dart_webapp",
} as const

export const absoluteUrl = (path = "/") => `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`
