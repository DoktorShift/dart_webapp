import { ImageResponse } from "next/og"
import { boardIconSvg, svgDataUri } from "@/lib/board-icon"

// Home-screen icon for iPhone and iPad. iOS rounds the corners itself, so the background is full-bleed.
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    <img src={svgDataUri(boardIconSvg(0.84))} width={size.width} height={size.height} alt="" />,
    size,
  )
}
