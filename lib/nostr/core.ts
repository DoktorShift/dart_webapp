// The only door to nostr-core at runtime. Everything that needs the library awaits loadCore(),
// so the guest path never downloads it: ./runtime.ts (the one module that imports nostr-core's
// code) is reached only through the dynamic import below (docs/decisions/0002, sections 1 and
// 2). Other modules name types via ./types.ts.
export type Core = typeof import("./runtime.ts")

let loading: Promise<Core> | null = null

// One shared, cached import. A failed load (offline before the chunk was cached) is forgotten,
// so the next call tries again instead of failing forever.
export function loadCore(): Promise<Core> {
  loading ??= import("./runtime.ts").catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
