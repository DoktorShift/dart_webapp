import type { MetadataRoute } from "next"
import { ICON_BACKGROUND } from "@/lib/board-icon"
import { MESSAGES } from "@/lib/i18n"
import { SITE } from "@/lib/site"

// Lets phones and tablets install the app to the home screen and open it full screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: SITE.shortName,
    description: MESSAGES.de.meta.description,
    lang: "de",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: ICON_BACKGROUND,
    theme_color: ICON_BACKGROUND,
    categories: ["games", "sports", "entertainment"],
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Shown by Android and desktop Chrome in the install dialog.
    screenshots: [
      { src: "/screenshots/phone-501.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "Ein 501-Spiel auf dem Handy mit Checkout-Weg" },
      { src: "/screenshots/tablet-cricket.png", sizes: "2360x1640", type: "image/png", form_factor: "wide", label: "Cricket für vier auf dem Tablet" },
    ],
  }
}
