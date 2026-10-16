"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { ClubHeader, formatDate, formatDateTime, useChange } from "@/components/clubs/common"
import { useInlineProfile } from "@/components/profile/inline-profile"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { nextDate, type ClubView } from "@/lib/clubs/club"
import { acceptInvitation, invitationState, openInvitation, type InvitationProblem } from "@/lib/clubs/invitation"
import { readClubPayload } from "@/lib/clubs/links"
import { forgetClub } from "@/lib/clubs/store"
import { nowSeconds } from "@/lib/nostr/time"
import { SCREENS, runAction, type ScreenProps } from "@/lib/shell/registry"

// An invitation: opened from its link (params.payload, with the secret that shows a closed
// club's preview) or again from the Clubs tab (params.club). What the club is and who invites,
// then one button. Viewing needs no profile; joining makes one on the way for a guest.
export default function InviteScreen({ params }: ScreenProps) {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const address = useMemo(() => (params.payload ? readClubPayload(params.payload) : null), [params.payload])
  const clubId = address?.club ?? params.club ?? null
  const [attempt, setAttempt] = useState(0)
  // While the link's invitation is fetched, then the problem it ran into, if any.
  const [opening, setOpening] = useState<"loading" | InvitationProblem | null>(address?.invite ? "loading" : null)

  useEffect(() => {
    const invite = address?.invite
    if (!address || !invite) return
    let alive = true
    setOpening("loading")
    void openInvitation({ ...address, invite }).then(
      (problem) => alive && setOpening(problem),
      () => alive && setOpening("offline"),
    )
    return () => {
      alive = false
    }
  }, [address, attempt])

  // A link that names only the club: the club itself.
  useEffect(() => {
    if (address && !address.invite) nav.replaceTop(CLUB_SCREENS.view, { club: address.club })
  }, [address, nav])

  const { view, loaded, missing } = useClub(opening === "loading" ? null : clubId)

  // Not a complete link: scanning the code is the way forward.
  if (!clubId || (params.payload && !address)) {
    return (
      <div className="pb-4">
        <InlineStatus tone="error" className="mt-6">
          {tx.invite.invalid}
        </InlineStatus>
        <Button onClick={() => runAction(SCREENS.clubOpenInvite, nav)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.home.openInvite}
        </Button>
      </div>
    )
  }
  if (address && !address.invite) return null
  if (opening && opening !== "loading") {
    return (
      <div className="pb-4">
        <InlineStatus tone="error" className="mt-6">
          {tx.invite[opening]}
        </InlineStatus>
        {opening === "offline" && (
          <Button onClick={() => setAttempt((n) => n + 1)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {tx.retry}
          </Button>
        )}
      </div>
    )
  }
  if (!view) {
    if (opening === null && loaded && missing) return <InlineStatus tone="error" className="mt-6">{tx.invite.missing}</InlineStatus>
    return <p className="mt-6 px-4 text-[1.0625rem] text-muted-foreground">{tx.invite.loading}</p>
  }
  return <Invitation view={view} />
}

function Invitation({ view }: { view: ClubView }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const guest = useInlineProfile()
  const describe = useChange()
  const now = nowSeconds()
  const opened = view.invite
  const preview = opened?.preview
  const record = opened && view.state ? view.state.invites[opened.invite] : undefined
  const host = preview?.host ?? record?.by ?? null
  const names = useProfileNames(host ? [host] : [])
  const hostName = preview?.hostName ?? (host ? names(host).name : null)
  const kind = record?.kind ?? preview?.kind
  const expires = record?.expires ?? preview?.expires
  const next = preview?.next ?? nextDate(view, now)
  const state = invitationState(view, now)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [joinedHere, setJoinedHere] = useState(false)

  const join = async () => {
    setBusy(true)
    setProblem(null)
    try {
      if (!(await guest.ensure())) return
      await acceptInvitation(view.id, await clubAuthor())
      setJoinedHere(true)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }
  const decline = async () => {
    await forgetClub(view.id)
    nav.pop()
  }
  const openClub = () => nav.replaceTop(CLUB_SCREENS.view, { club: view.id, name: view.info?.name ?? "" })
  const backToPlay = () => {
    nav.popToRoot("clubs")
    nav.selectTab("play")
  }
  const primary = "mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold"
  const quiet = "mt-2 h-12 w-full rounded-2xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"

  let outcome: { tone: "success" | "info"; text: string; action: { label: string; onClick: () => void } } | null = null
  if (view.me.status === "member") outcome = { tone: "success", text: joinedHere ? tx.invite.joined : tx.invite.alreadyMember, action: { label: tx.invite.openClub, onClick: openClub } }
  else if (view.me.status === "joined") outcome = { tone: "success", text: tx.invite.joinedWaiting, action: { label: tx.invite.openClub, onClick: openClub } }
  else if (view.me.status === "request") outcome = { tone: "info", text: tx.invite.requested, action: { label: tx.invite.backToPlay, onClick: backToPlay } }
  const over = state === "expired" ? tx.invite.expired : state === "used" ? tx.invite.used : state === "ended" ? tx.invite.ended : null

  return (
    <div className="pb-4">
      <ClubHeader view={view} subtitle={hostName ? tx.invite.from(hostName) : tx.invite.fromClub} />
      <div className="mt-4 flex flex-col gap-1 px-4 text-[0.9375rem] leading-snug text-muted-foreground">
        {kind && !outcome && <p>{kind === "group" ? (state === "request" ? tx.invite.groupLimited : tx.invite.group) : tx.invite.personal}</p>}
        {expires !== undefined && !over && <p>{tx.invite.until(formatDate(expires, t))}</p>}
        {next && <p>{tx.home.next(formatDateTime(next.starts, t))}</p>}
        {view.info?.visibility === "closed" && <p>{tx.invite.closedHint}</p>}
      </div>
      {outcome ? (
        <>
          <InlineStatus tone={outcome.tone} className="mt-6">
            {outcome.text}
          </InlineStatus>
          <Button onClick={outcome.action.onClick} className={primary}>
            {outcome.action.label}
          </Button>
        </>
      ) : over ? (
        <>
          <InlineStatus tone="error" className="mt-6">
            {over}
          </InlineStatus>
          <Button variant="ghost" onClick={() => void decline()} className={quiet}>
            {tx.invite.decline}
          </Button>
        </>
      ) : (
        <>
          {guest.fields}
          {problem && (
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
          )}
          <Button onClick={() => void join()} disabled={!guest.ready || busy} className={primary}>
            {busy ? tx.invite.sending : state === "open" ? tx.invite.join : tx.invite.request}
          </Button>
          <Button variant="ghost" onClick={() => void decline()} disabled={busy} className={quiet}>
            {tx.invite.decline}
          </Button>
        </>
      )}
      {guest.dialog}
    </div>
  )
}
