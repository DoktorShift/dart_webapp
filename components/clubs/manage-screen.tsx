"use client"

import { useState } from "react"
import { Download, Link, Pencil, Trophy, Users } from "lucide-react"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { taskLabel, useChange } from "@/components/clubs/common"
import { Confirm } from "@/components/ui/confirm"
import { DecideSheet, EditSheet, InvitesSheet, type Decision } from "@/components/clubs/manage-sheets"
import { RequestList } from "@/components/clubs/request-list"
import { AwardsRow, useMissingAwards } from "@/components/clubs/season-awards"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { clubTasks, isManager } from "@/lib/clubs/club"
import { clubExport } from "@/lib/clubs/export"
import { cancelOffer, offerOwnership, openOffer, updateInfo } from "@/lib/clubs/membership"
import type { Author } from "@/lib/clubs/send"
import { loadStoredClub } from "@/lib/clubs/store"
import { grantAccess } from "@/lib/clubs/sync"
import { currentSeason } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import { saveFile } from "@/lib/save-file"
import type { ScreenProps } from "@/lib/shell/registry"

// "Club verwalten" (PLAN.md): open tasks first (requests, results the rules can't settle,
// access for new members, a hand-over under way or lapsed, badges of an ended season not given
// yet), then members, invitations, the
// season, the club's details, the export, and for the owner the archive. Nothing here is
// needed to play.
export default function ManageScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const describe = useChange()
  const { view, refresh } = useClub(params.club ?? null)
  const state = view?.state
  const names = useProfileNames(state?.offer ? [state.offer.to] : [])
  const awards = useMissingAwards(view)
  const [deciding, setDeciding] = useState<Decision | null>(null)
  const [editing, setEditing] = useState(false)
  const [invites, setInvites] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [offering, setOffering] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (!view || !state) return null
  const now = nowSeconds()
  const owner = view.me.role === "owner"
  const manager = isManager(view.me.role)
  const archived = state.info.archived
  const season = currentSeason(state, now)
  // Requests are a manager's task (listed with their buttons); a tournament director has none here.
  const requests = manager ? Object.keys(state.requests).length : 0
  const tasks = clubTasks(view, now).filter((task) => task.kind === "decide" || task.kind === "access")
  const offer = openOffer(state, now)
  // An offer nobody accepted in time: the owner may make a new one.
  const lapsed = owner && state.offer && !offer ? state.offer : null
  const nothing = requests === 0 && tasks.length === 0 && !offer && !lapsed && awards.length === 0
  const name = params.name ?? state.info.name

  const run = async (action: (author: Author) => Promise<unknown>) => {
    setProblem(null)
    try {
      await action(await clubAuthor())
    } catch (error) {
      setProblem(describe(error))
    }
  }
  const exportClub = async () => {
    const stored = await loadStoredClub(view.id)
    if (!stored) return
    const file = `blueline-club-${state.info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || view.id.slice(0, 8)}.json`
    saveFile(new Blob([JSON.stringify(clubExport(stored, view), null, 2)], { type: "application/json" }), file)
  }
  // Offered on a device that just loaded (club.md "Übergabe").
  const offerAgain = (to: string) => void run(async (author) => offerOwnership((await refresh())?.state ?? state, to, author))

  return (
    <div className="pb-4">
      {nothing ? (
        <Group title={tx.manage.tasks}>
          <ListRow title={tx.manage.noTasks} />
        </Group>
      ) : (
        <>
          {manager && <RequestList state={state} />}
          {(tasks.length > 0 || offer || lapsed || awards.length > 0) && (
            <Group title={tx.manage.tasks}>
              {tasks.map((task) =>
                task.kind === "decide" ? (
                  <ListRow key={task.game.match} title={taskLabel(task, tx, t)} onClick={() => setDeciding({ game: task.game, why: task.why })} />
                ) : (
                  <ListRow key={task.kind} title={taskLabel(task, tx, t)} onClick={() => void run((author) => grantAccess(view.id, author))} />
                ),
              )}
              {offer && owner && <ListRow title={tx.members.offerPending(names(offer.to).name ?? tx.unnamed)} value={tx.members.cancelOffer} onClick={() => setWithdrawing(true)} />}
              {lapsed && <ListRow title={tx.members.offerExpired(names(lapsed.to).name ?? tx.unnamed)} value={tx.members.offerAgain} onClick={() => setOffering(true)} />}
              {awards.map((occasion) => (
                <AwardsRow key={occasion.occasionId} occasion={occasion} onDone={setProblem} />
              ))}
            </Group>
          )}
        </>
      )}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Group>
        <ListRow icon={Users} iconTone="blue" title={tx.manage.members} value={Object.keys(state.members).length} onClick={() => nav.push(CLUB_SCREENS.members, { club: view.id, name })} />
        {manager && <ListRow icon={Link} iconTone="teal" title={tx.manage.invites} onClick={() => setInvites(true)} />}
        {manager && <ListRow icon={Trophy} iconTone="orange" title={tx.manage.season} value={season?.name} onClick={() => nav.push(CLUB_SCREENS.season, { club: view.id, name })} />}
        {manager && <ListRow icon={Pencil} iconTone="gray" title={tx.manage.details} onClick={() => setEditing(true)} />}
      </Group>
      <Group footer={tx.manage.exportHint}>
        <ListRow icon={Download} iconTone="green" title={tx.manage.export} onClick={() => void exportClub()} />
      </Group>
      {owner && (
        <Group>
          <ListRow title={archived ? tx.manage.unarchive : tx.manage.archive} destructive={!archived} onClick={() => (archived ? void run((author) => updateInfo(state, { archived: false }, author)) : setArchiving(true))} />
        </Group>
      )}

      {season && <DecideSheet view={view} state={state} season={season} decision={deciding} open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)} />}
      {editing && <EditSheet view={view} state={state} open onOpenChange={setEditing} />}
      <InvitesSheet view={view} state={state} open={invites} onOpenChange={setInvites} />
      <Confirm open={archiving} onOpenChange={setArchiving} title={tx.manage.archiveTitle} text={tx.manage.archiveText} confirm={tx.manage.archiveConfirm} destructive onConfirm={() => void run((author) => updateInfo(state, { archived: true }, author))} />
      <Confirm open={withdrawing} onOpenChange={setWithdrawing} title={tx.members.cancelOffer} text={tx.members.offerText} confirm={tx.members.cancelOffer} destructive onConfirm={() => void run((author) => cancelOffer(state, author))} />
      {lapsed && (
        <Confirm open={offering} onOpenChange={setOffering} title={tx.members.offerTitle(names(lapsed.to).name ?? tx.unnamed)} text={tx.members.offerText} confirm={tx.members.offerConfirm} onConfirm={() => offerAgain(lapsed.to)} />
      )}
    </div>
  )
}
