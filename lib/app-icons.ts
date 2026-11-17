// The app's icons at /icon/<id> (app/icon/[id]/route.tsx). `fill` is how much of the square the
// board takes; maskable icons leave room for the shape Android crops them to.
export const ICONS = [
  { id: "192", size: 192, fill: 0.86 },
  { id: "512", size: 512, fill: 0.86 },
  { id: "maskable", size: 512, fill: 0.7 },
] as const

// For the page head: the plain icons, not the maskable one (that is for the manifest).
export const HEAD_ICONS = ICONS.filter((icon) => icon.id !== "maskable").map(({ id, size }) => ({
  url: `/icon/${id}`,
  sizes: `${size}x${size}`,
  type: "image/png",
}))
