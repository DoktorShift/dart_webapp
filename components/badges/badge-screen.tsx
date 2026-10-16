"use client"

import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DisclosureRow, Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { awardTexts, milestoneOf, milestoneTexts, problemText, progressText } from "@/components/badges/texts"
import { awardVoided, selfAwardFor, useMilestones, useOwnBadges } from "@/components/badges/use-badges"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { useOwnProfile, usePublicProfile, type OwnProfile } from "@/components/profile/use-profile"
import { hideAwards, requestDeletion, showAward, showMilestone, type Outcome } from "@/lib/badges/actions"
import type { ValidAward } from "@/lib/badges/awards"
import { milestoneById } from "@/lib/badges/catalog"
import type { Achievement } from "@/lib/badges/milestones"
import { shownBadges, shownElsewhereAward } from "@/lib/badges/store"
import { formatWhen, modeName } from "@/lib/i18n"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import { readMetadata } from "@/lib/profile/metadata"
import { lookupOwnEvents } from "@/lib/profile/own-events"
import { useSession } from "@/lib/profile/session"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// One badge (PLAN.md "Auszeichnungen": "Bedeutung, Aussteller, erreicht am, zugehöriges Ergebnis
// und Sichtbarkeit"): an award of the signed-in profile (params.id), a milestone a player
// reached on this device (params.milestone, params.key), or a badge on someone else's profile
// (params.id and params.pubkey, seen on their card). Showing in the profile and taking out of it
// are the one action each; a corrected result is said plainly, with the deletion request for
// one's own award.
export default function BadgeScreen({ params }: ScreenProps) {
  const session = useSession()
  const own = useOwnProfile()
  if (session === undefined || own === undefined) return null
  if (params.milestone) return <MilestoneView id={params.milestone} playerKey={params.key ?? own?.key ?? ""} own={own} />
  // Whose award it is decides the view, not who is signed in: a chip on another player's card
  // names that player.
  const theirs = !!params.pubkey && params.pubkey !== own?.session.pubkey
  if (own && !theirs) return <OwnAwardView id={params.id ?? ""} own={own} />
  return <ForeignAwardView id={params.id ?? ""} pubkey={params.pubkey ?? null} />
}

// ---- The pieces ---------------------------------------------------------------------------------

function Head({ image, name, description, status }: { image?: string | null; name: string; description: string; status: string }) {
  return (
    <section className="mt-4 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <BadgeIcon image={image} size={64} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{name}</h2>
          <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground">{status}</p>
        </div>
      </div>
      {description && <p className="mt-3 border-t border-border pt-3 text-[1.0625rem] leading-snug">{description}</p>}
    </section>
  )
}

// The game a milestone was reached in: on this device it opens; from another device it is
// named by what the evidence says.
function ResultRow({ matchId, finishedAt, modeId }: { matchId: string; finishedAt: string; modeId: string }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { all } = useMatchHistory()
  const match = all.find((m) => m.id === matchId)
  const label = `${modeName(t, modeId, match?.modeName ?? modeId)} · ${formatWhen(finishedAt, t)}`
  return match ? <ListRow title={tx.detail.result} value={label} onClick={() => nav.push(PROFILE_SCREENS.match, { id: match.id })} /> : <ListRow title={tx.detail.result} value={label} subtitle={tx.detail.resultElsewhere} />
}

function IssuerRow({ pubkey }: { pubkey: string }) {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const { profile } = usePublicProfile(pubkey)
  const name = readMetadata(profile?.metadata).name
  return <ListRow title={tx.detail.issuer} value={name ?? tx.detail.issuerUnknown} onClick={() => nav.push(SCREENS.profilePublic, { pubkey })} />
}

function Advanced({ award }: { award: ValidAward }) {
  const tx = useAreaT(BADGES_TEXTS)
  const a = tx.advanced
  const short = (hex: string) => hex.slice(0, 12)
  return (
    <Group>
      <DisclosureRow title={a.title}>
        <dl className="space-y-1 font-mono text-[0.8125rem]">
          <div>
            <dt className="font-sans text-foreground">{a.issuerKey}</dt>
            <dd className="select-all break-all">{short(award.issuer)}</dd>
          </div>
          <div>
            <dt className="font-sans text-foreground">{a.eventId}</dt>
            <dd className="select-all break-all">{short(award.award.id)}</dd>
          </div>
          <div>
            <dt className="font-sans text-foreground">{a.definition}</dt>
            <dd className="select-all break-all">{award.blueline ? `${award.blueline.badge} v${award.blueline.version}` : award.definition.tags.find((t) => t[0] === "d")?.[1]}</dd>
          </div>
        </dl>
      </DisclosureRow>
    </Group>
  )
}

// Runs one change and says what went wrong, in place.
function useChange() {
  const tx = useAreaT(BADGES_TEXTS)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (change: () => Promise<Outcome>) => {
    setBusy(true)
    setProblem(null)
    try {
      if ((await change()) === "offline") setProblem(problemText(tx, "offline"))
    } catch (error) {
      setProblem(problemText(tx, error))
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, run }
}

// Before a change, the profile's list is looked up again (like editing the profile).
function useFreshList(pubkey: string) {
  useEffect(() => {
    void lookupOwnEvents(pubkey, { again: true })
  }, [pubkey])
}

// The one action with an honest footer: what showing publishes (a milestone's game data), or
// that an award already published only goes onto the card.
function Visibility({ shown, published, onShow, onHide, busy, problem }: { shown: boolean; published: boolean; onShow: () => void; onHide?: () => void; busy: boolean; problem: string | null }) {
  const tx = useAreaT(BADGES_TEXTS)
  const d = tx.detail
  return (
    <>
      <Group footer={shown ? d.hideFooter : published ? d.publishedFooter : d.showFooter}>
        <ListRow title={d.visibility} value={shown ? d.inProfile : d.notInProfile} />
      </Group>
      {shown ? (
        <Button variant="secondary" disabled={busy} onClick={onHide} className="mt-3 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {d.hide}
        </Button>
      ) : (
        <Button disabled={busy} onClick={onShow} className="mt-3 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {d.show}
        </Button>
      )}
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
    </>
  )
}

// "Löschung anfragen" for one's own award whose result no longer holds.
function DeletionRequest({ pubkey, award, onDone }: { pubkey: string; award: ValidAward; onDone: () => void }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const d = tx.detail
  const [asking, setAsking] = useState(false)
  const { busy, problem, run } = useChange()
  return (
    <>
      <Group>
        <ListRow title={d.requestDeletion} destructive disabled={busy} onClick={() => setAsking(true)} />
      </Group>
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{d.requestDeletionTitle}</AlertDialogTitle>
            <AlertDialogDescription>{d.requestDeletionDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(() => requestDeletion(pubkey, [award], d.voided)).then(onDone)}
              className="h-11 bg-danger text-white hover:bg-danger/90"
            >
              {d.requestDeletionConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---- Views ----------------------------------------------------------------------------------------

// A milestone of the catalog for a player on this device: reached (and then maybe published as
// the profile's own award, which takes over) or still within reach.
function MilestoneView({ id, playerKey, own }: { id: string; playerKey: string; own: OwnProfile | null }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const d = tx.detail
  const milestone = milestoneById(id)
  const mine = !!own && playerKey === own.key
  const { statuses, loaded } = useMilestones(playerKey || null, own?.history.aliases, mine ? own?.sameAs : undefined)
  const badges = useOwnBadges(mine ? own.session.pubkey : null)
  const award = milestone && mine ? selfAwardFor(badges, own.session.pubkey, milestone.id, milestone.version) : undefined
  if (award && own) return <OwnAwardView id={award.award.id} own={own} />
  if (!milestone) return <InlineStatus tone="error" className="mt-6">{d.unavailable}</InlineStatus>
  if (!loaded || (mine && badges.awards === null)) return null
  const status = statuses.find((s) => s.milestone.id === milestone.id)
  const words = milestoneTexts(tx, milestone)
  const achieved = status?.achieved ?? null
  return (
    <>
      <Head name={words.name} description={words.description} status={achieved ? d.onDevice : tx.list.reachable} />
      <Group>
        <ListRow title={d.condition} subtitle={words.condition} />
        {status && !achieved && <ListRow title={d.progress} value={progressText(t, tx, status)} />}
        {achieved && <ListRow title={d.earnedAt} value={formatWhen(achieved.finishedAt, t)} />}
        {achieved && <ResultRow matchId={achieved.matchId} finishedAt={achieved.finishedAt} modeId={achieved.modeId} />}
      </Group>
      {achieved && mine && <ShowMilestone pubkey={own.session.pubkey} milestone={milestone} achieved={achieved} />}
    </>
  )
}

function ShowMilestone({ pubkey, milestone, achieved }: { pubkey: string; milestone: NonNullable<ReturnType<typeof milestoneById>>; achieved: Achievement }) {
  const tx = useAreaT(BADGES_TEXTS)
  const { busy, problem, run } = useChange()
  useFreshList(pubkey)
  return <Visibility shown={false} published={false} busy={busy} problem={problem} onShow={() => void run(() => showMilestone(pubkey, milestone, achieved, milestoneTexts(tx, milestone), tx.detail.voided))} />
}

// An award of the signed-in profile: self-earned, or given by someone.
function OwnAwardView({ id, own }: { id: string; own: OwnProfile }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const d = tx.detail
  const { pubkey } = own.session
  const badges = useOwnBadges(pubkey)
  const { busy, problem, run } = useChange()
  // After a deletion request the award is gone from the lists; the screen keeps what it showed.
  const [requested, setRequested] = useState<ValidAward | null>(null)
  useFreshList(pubkey)
  if (badges.awards === null) return null
  const award = badges.awards.find((a) => a.award.id === id) ?? requested
  if (!award) return <InlineStatus tone="error" className="mt-6">{d.unavailable}</InlineStatus>

  const words = awardTexts(tx, award)
  const self = award.issuer === pubkey
  const milestone = milestoneOf(award)
  const result = badges.evidence.get(award.blueline?.evidence ?? "")?.content.result
  const voided = requested !== null || awardVoided(own, badges, award)
  const shown = badges.shown.some((a) => a.award.id === id)
  const at = result ? new Date(result.finishedAt * 1000).toISOString() : new Date(award.award.created_at * 1000).toISOString()

  return (
    <>
      <Head image={award.image} name={words.name} description={words.description} status={self ? d.self : tx.list.received} />
      {voided && (
        <InlineStatus tone="error" className="mt-4">
          {self ? d.voided : d.voidedReceived}
        </InlineStatus>
      )}
      <Group>
        {milestone && <ListRow title={d.condition} subtitle={milestoneTexts(tx, milestone).condition} />}
        <ListRow title={self ? d.earnedAt : d.givenAt} value={formatWhen(at, t)} />
        {result && <ResultRow matchId={result.game} finishedAt={at} modeId={result.mode} />}
        {self ? <ListRow title={d.issuer} value={`${d.you} · ${d.self}`} /> : <IssuerRow pubkey={award.issuer} />}
      </Group>
      {!voided && <Visibility shown={shown} published busy={busy} problem={problem} onShow={() => void run(() => showAward(pubkey, award))} onHide={() => void run(() => hideAwards(pubkey, [id]))} />}
      {voided && self && requested && (
        <InlineStatus tone="success" className="mt-4">
          {d.deletionRequested}
        </InlineStatus>
      )}
      {voided && self && !requested && <DeletionRequest pubkey={pubkey} award={award} onDone={() => setRequested(award)} />}
      <Advanced award={award} />
    </>
  )
}

// A badge on someone else's profile, as their card showed it; after a reload it is looked up
// from their list again. For a BlueLine milestone the catalog says what it took.
function ForeignAwardView({ id, pubkey }: { id: string; pubkey: string | null }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const d = tx.detail
  // undefined: not known here yet; null: not among the badges that profile shows.
  const [award, setAward] = useState<ValidAward | null | undefined>(() => shownElsewhereAward(id))
  useEffect(() => {
    if (award || !pubkey) return
    let alive = true
    shownBadges(pubkey).then(
      () => alive && setAward(shownElsewhereAward(id) ?? null),
      () => alive && setAward(null),
    )
    return () => {
      alive = false
    }
  }, [award, id, pubkey])
  if (award === undefined && pubkey) return null
  if (!award) return <InlineStatus tone="error" className="mt-6">{d.unavailable}</InlineStatus>
  const words = awardTexts(tx, award)
  const self = award.issuer === award.recipient
  const milestone = milestoneOf(award)
  return (
    <>
      <Head image={award.image} name={words.name} description={words.description} status={self ? d.self : d.issuer} />
      <Group>
        {milestone && <ListRow title={d.condition} subtitle={milestoneTexts(tx, milestone).condition} />}
        <ListRow title={d.givenAt} value={formatWhen(new Date(award.award.created_at * 1000).toISOString(), t)} />
        <IssuerRow pubkey={award.issuer} />
      </Group>
      <Advanced award={award} />
    </>
  )
}
