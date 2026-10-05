// Ids for new objects: 128 random bits from the browser's secure random source, as hex. Old ids
// (from version 1.0.0, like "mut3p9t1-9znimr") stay valid as they are; nothing is renamed.

export function randomHex(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (b) => b.toString(16).padStart(2, "0")).join("")
}

export const newObjectId = () => randomHex(16)
