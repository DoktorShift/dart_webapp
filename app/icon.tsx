import { ImageResponse } from "next/og"
import { boardIconSvg, svgDataUri } from "@/lib/board-icon"

// App icons rendered at build time from the board geometry: /icon/192, /icon/512 and
// /icon/maskable (Android crops maskable icons to a circle or squircle, so the board is smaller).
const ICONS = [
  { id: "192", size: 192, fill: 0.86 },
  { id: "512", size: 512, fill: 0.86 },
  { id: "maskable", size: 512, fill: 0.7 },
]

// Rendered once at build time, so the icons are plain static files on any host.
export const dynamic = "force-static"

export function generateImageMetadata() {
  return ICONS.map(({ id, size }) => ({ id, size: { width: size, height: size }, contentType: "image/png" }))
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  const iconId = await id
  const icon = ICONS.find((i) => i.id === iconId) ?? ICONS[1]
  return new ImageResponse(
    <img src={svgDataUri(boardIconSvg(icon.fill))} width={icon.size} height={icon.size} alt="" />,
    { width: icon.size, height: icon.size },
  )
}
