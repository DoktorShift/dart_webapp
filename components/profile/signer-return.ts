import { completeAnswer } from "@/lib/profile/android-signer"
import { rememberOwn } from "@/lib/profile/own-events"
import { loadSession } from "@/lib/profile/session"
import { SCREENS, type ShellNavigator } from "@/lib/shell/registry"
import { publish } from "@/lib/sync/publish"

// An Android signer's answer arriving as /#signer-return… (lib/profile/android-signer.ts):
// - a key for signing in: "Mit einer anderen App" continues with "Bist du das?";
// - a signature: when no page is waiting for it any more (the answer opened a new tab, or the
//   page was reloaded), it is kept and published here, as the waiting page would have.
// Anything else (an old link from the history, an answer already taken) changes nothing.
export async function handleSignerReturn(payload: string, nav: ShellNavigator) {
  const answer = await completeAnswer(payload).catch(() => null)
  if (answer?.type === "pubkey") {
    if (nav.tab === "profile") nav.replaceTop(SCREENS.profileFromApp, { androidKey: answer.pubkey })
    else nav.push(SCREENS.profileFromApp, { androidKey: answer.pubkey }, { tab: "profile" })
  } else if (answer?.type === "signed" && !answer.awaited) {
    const session = await loadSession()
    if (session?.pubkey !== answer.event.pubkey) return
    await rememberOwn(session.pubkey, [answer.event])
    await publish([answer.event])
  }
}
