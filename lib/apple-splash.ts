// Launch screens for the app installed on an iPhone or iPad home screen. iOS shows the image
// whose media query matches the device while the app starts; without one it shows a blank
// screen. One image per screen size and orientation, in device pixels.

interface Screen {
  // CSS points and pixel ratio, as Safari reports them in media queries.
  width: number
  height: number
  ratio: number
}

const SCREENS: Screen[] = [
  // iPhone
  { width: 375, height: 667, ratio: 2 }, // SE 2nd/3rd gen, 8
  { width: 414, height: 736, ratio: 3 }, // 8 Plus
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e
  { width: 428, height: 926, ratio: 3 }, // 12/13 Pro Max, 14 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 420, height: 912, ratio: 3 }, // Air
  // iPad
  { width: 744, height: 1133, ratio: 2 }, // mini 6th gen and later
  { width: 768, height: 1024, ratio: 2 }, // mini 5, 9.7"
  { width: 810, height: 1080, ratio: 2 }, // 10.2"
  { width: 820, height: 1180, ratio: 2 }, // Air 4th/5th gen, iPad 10th gen and later, Air 11"
  { width: 834, height: 1112, ratio: 2 }, // Air 3rd gen, Pro 10.5"
  { width: 834, height: 1194, ratio: 2 }, // Pro 11"
  { width: 834, height: 1210, ratio: 2 }, // Pro 11" (M4)
  { width: 1024, height: 1366, ratio: 2 }, // Pro 12.9", Air 13"
  { width: 1032, height: 1376, ratio: 2 }, // Pro 13" (M4)
]

export interface SplashImage {
  // Pixel size, also the image's id in the URL, e.g. "1170x2532".
  id: string
  width: number
  height: number
  media: string
}

export const SPLASH_IMAGES: SplashImage[] = SCREENS.flatMap(({ width, height, ratio }) =>
  (["portrait", "landscape"] as const).map((orientation) => {
    const [w, h] = orientation === "portrait" ? [width, height] : [height, width]
    return {
      id: `${w * ratio}x${h * ratio}`,
      width: w * ratio,
      height: h * ratio,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
    }
  }),
)
