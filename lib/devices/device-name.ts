// What this device is called in a pairing and in the device list: the kind of device and its
// browser, as far as the browser says ("iPhone · Safari"). Brand names only, so the other
// device shows it the same in every language. At most 40 characters (lib/protocol/pairing.ts).

export const MAX_DEVICE_NAME = 40

const DEVICES: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "Chromebook"],
  [/Macintosh|Mac OS/, "Mac"],
  [/Linux/, "Linux"],
]

const BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser/, "Samsung Internet"],
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox|FxiOS/, "Firefox"],
  [/CriOS|Chrome/, "Chrome"],
  [/Safari/, "Safari"],
]

const match = (list: [RegExp, string][], agent: string) => list.find(([pattern]) => pattern.test(agent))?.[1]

export function deviceName(agent = navigator.userAgent, touchPoints = navigator.maxTouchPoints): string {
  // iPadOS Safari calls itself a Mac; touch tells it apart.
  const device = /Macintosh/.test(agent) && touchPoints > 1 ? "iPad" : match(DEVICES, agent)
  const browser = match(BROWSERS, agent)
  return [device ?? "Computer", browser].filter(Boolean).join(" · ").slice(0, MAX_DEVICE_NAME)
}
