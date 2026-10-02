import qrcode from "qrcode-generator"

// A QR code as SVG markup, drawn at build time (no script in the page): dark squares on white
// with the quiet zone scanners need around it.
export function qrSvg(text: string) {
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
  const box = size + 4
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${box} ${box}" width="100%" height="100%" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#020817"/></svg>`
}
