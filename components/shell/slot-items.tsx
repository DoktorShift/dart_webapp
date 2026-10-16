"use client"

import { Component, Suspense, type ReactNode, type Ref } from "react"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { getSlotItems, type SlotListId, type SlotListProps } from "@/lib/shell/registry"

// One piece from an area. If it throws or its code can't be fetched, it is left out: an area
// must never stand between the players and their game or its result.
class Fenced extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

// What areas registered for a slot list (lib/shell/registry.ts), in registration order, inside
// a wrapper with `className`. Renders nothing, not even the wrapper, while nothing is registered.
// Without className the pieces go straight into the parent, so rows in a Group get its
// separators, and a piece that renders nothing leaves no trace. `ref` is the wrapper: its
// children are the pieces that show something for this game.
export function SlotItems<K extends SlotListId>({
  list,
  props,
  className,
  ref,
}: {
  list: K
  // The props for the piece with this id.
  props: (id: string) => SlotListProps[K]
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  useRegistryVersion()
  const items = getSlotItems(list)
  if (items.length === 0) return null
  const pieces = items.map(({ id, Component: Piece }) => (
    <Fenced key={id}>
      <Suspense fallback={null}>
        <Piece {...props(id)} />
      </Suspense>
    </Fenced>
  ))
  return className === undefined ? pieces : <div ref={ref} className={className}>{pieces}</div>
}
