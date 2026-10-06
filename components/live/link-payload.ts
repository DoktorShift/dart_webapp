import { decodeLinkPayload, type LinkPayload, type LinkType } from "@/lib/protocol/links"

// The payload of the app link a live screen was opened with (params.payload), or null when it
// isn't one of this kind: a damaged link, or a code meant for another flow.
export function readPayload<T extends LinkType>(type: T, payload: string | undefined): Extract<LinkPayload, { type: T }> | null {
  if (!payload) return null
  try {
    return decodeLinkPayload(type, decodeURIComponent(payload))
  } catch {
    return null
  }
}
