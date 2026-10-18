import qrcode from "qrcode-generator"

// A QR code as one SVG path of its dark modules, in a box of `size` × `size` modules. Shared by
// the build-time SVG below and the in-app QR view, which draws the path itself.
export function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, "M")
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  let path = ""
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return { size, path }
}

// A QR code as SVG markup, drawn at build time (no script in the page): dark squares on white
// with the quiet zone scanners need around it.
export function qrSvg(text: string) {
  const { size, path } = qrPath(text)
  const box = size + 4
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${box} ${box}" width="100%" height="100%" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#020817"/></svg>`
}
