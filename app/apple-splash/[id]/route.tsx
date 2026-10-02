import { ImageResponse } from "next/og"
import { ICON_BACKGROUND, boardIconSvg, svgDataUri } from "@/lib/board-icon"
import { SPLASH_IMAGES } from "@/lib/apple-splash"

// Launch screen: the app's dark background with the board in the middle, so opening the
// installed app goes straight from the icon to the board without a white flash.
export const dynamic = "force-static"
export const dynamicParams = false

export function generateStaticParams() {
  return SPLASH_IMAGES.map(({ id }) => ({ id }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const image = SPLASH_IMAGES.find((s) => s.id === id)
  if (!image) return new Response(null, { status: 404 })
  const board = Math.round(Math.min(image.width, image.height) * 0.36)
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: ICON_BACKGROUND }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders this to a PNG, not a page */}
        <img src={svgDataUri(boardIconSvg(0.84))} width={board} height={board} alt="" />
      </div>
    ),
    { width: image.width, height: image.height },
  )
}
