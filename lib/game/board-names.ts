// Compact labels for crowded boards; the full names remain in the tile's accessible label.
export function compactBoardNames(names: readonly string[]): string[] {
  const first = names.map((name) => name.trim().split(/\s+/)[0] || name)
  const key = (name: string) => name.normalize("NFC").toLocaleLowerCase()
  const source = names.map((name, i) => first.filter((part) => key(part) === key(first[i])).length === 1 ? first[i] : name.trim())
  const shorten = (name: string, limit: number) => {
    const chars = Array.from(name)
    return chars.length <= limit ? name : `${chars.slice(0, limit - 1).join("")}…`
  }
  const labels = source.map((name) => shorten(name, 10))
  const unique = labels.map((label) => labels.filter((other) => key(other) === key(label)).length === 1)
  const used = new Set(labels.filter((_, i) => unique[i]).map(key))
  return labels.map((label, i) => {
    if (unique[i]) return label
    let number = i + 1
    let candidate: string
    do {
      const suffix = ` ${number++}`
      candidate = `${shorten(source[i], 10 - suffix.length)}${suffix}`
    } while (used.has(key(candidate)))
    used.add(key(candidate))
    return candidate
  })
}
