import { ImageResponse } from "next/og"
import { ICONS } from "@/lib/app-icons"
import { boardIconSvg, svgDataUri } from "@/lib/board-icon"

// App icons rendered at build time from the board geometry: /icon/192, /icon/512 and
// /icon/maskable (Android crops maskable icons to a circle or squircle, so the board is smaller).
// A route rather than app/icon.tsx with generateImageMetadata, which the iOS app's static export
// can't build; the layout's metadata names them for the page head.
export const dynamic = "force-static"
export const dynamicParams = false

export function generateStaticParams() {
  return ICONS.map(({ id }) => ({ id }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const icon = ICONS.find((i) => i.id === id)
  if (!icon) return new Response(null, { status: 404 })
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders this to a PNG, not a page
    <img src={svgDataUri(boardIconSvg(icon.fill))} width={icon.size} height={icon.size} alt="" />,
    { width: icon.size, height: icon.size },
  )
}
