import type { FriendsTexts } from "@/lib/i18n/features/friends.screens"

// One sentence for what went wrong with a change of the friends list.
export function friendsProblem(tx: FriendsTexts, error: unknown): string {
  const problem = (error as { problem?: string } | null)?.problem
  return (problem && problem in tx.problems ? tx.problems[problem as keyof typeof tx.problems] : null) ?? tx.problems.unknown
}
