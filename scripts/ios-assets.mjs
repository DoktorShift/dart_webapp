// Draws the iOS app's icon (1024 × 1024) and launch image (2732 × 2732) from the same board as
// the website's icons (lib/board-icon.ts), into the Xcode project's asset catalog.
//
//   npm run ios:assets        (macOS: needs `sips`, and Playwright's WebKit: npx playwright install webkit)
//
// The App Store refuses icons with an alpha channel, so the PNGs are sent through JPEG and back.

import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { webkit } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const assets = join(root, "ios/App/App/Assets.xcassets")
const jiti = createJiti(import.meta.url, { alias: { "@": root } })
const { boardIconSvg, ICON_BACKGROUND } = await jiti.import(join(root, "lib/board-icon.ts"))

// `board`: the board's share of the picture's width.
const pictures = [
  { file: join(assets, "AppIcon.appiconset/AppIcon-512@2x.png"), size: 1024, board: 1, fill: 0.84 },
  // Cropped to the screen's shape at launch; the board stays in the middle, as on the website's
  // launch screens (app/apple-splash), and the page that follows starts on the same background.
  ...["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"].map((name) => ({
    file: join(assets, "Splash.imageset", name),
    size: 2732,
    board: 0.26,
    fill: 0.84,
  })),
]

const browser = await webkit.launch()
try {
  for (const { file, size, board, fill } of pictures) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    const side = Math.round(size * board)
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${ICON_BACKGROUND}">` +
        `<div style="width:${side}px;height:${side}px">${boardIconSvg(fill).replace("<svg ", `<svg width="${side}" height="${side}" `)}</div></body>`,
    )
    await page.screenshot({ path: file, omitBackground: false })
    await page.close()
    const jpeg = `${file}.jpg`
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "best", file, "--out", jpeg], { stdio: "ignore" })
    execFileSync("sips", ["-s", "format", "png", jpeg, "--out", file], { stdio: "ignore" })
    rmSync(jpeg)
    console.log(`${size} × ${size}  ${file.slice(root.length + 1)}`)
  }
} finally {
  await browser.close()
}
