"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { useGuestProfile } from "@/components/clubs/guest-profile"
import { InviteSheet } from "@/components/clubs/invite-sheet"
import { CLUB_SCREENS } from "@/components/clubs/screens"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { foundClub } from "@/lib/clubs/membership"

// "Club gründen": a name, an optional description and who gets in ("Nur auf Einladung" is
// preselected and explained; "Öffentlich" is a conscious choice), one button. A guest gets a
// profile on the way. Right after founding, inviting members is the one thing offered.
export default function CreateScreen() {
  const tx = useAreaT(CLUBS_TEXTS)
  const c = tx.create
  const guest = useGuestProfile()
  const describe = useChange()
  const [name, setName] = useState("")
  const [about, setAbout] = useState("")
  const [visibility, setVisibility] = useState<"closed" | "public">("closed")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [founded, setFounded] = useState<string | null>(null)
  const ready = name.trim() !== "" && guest.ready

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      if (!(await guest.ensure())) return
      setFounded(await foundClub({ name, about, visibility }, await clubAuthor()))
    } catch (error) {
      setProblem(describe(error) === tx.club.noEncryption ? tx.club.noEncryption : c.failed)
    } finally {
      setBusy(false)
    }
  }

  if (founded) return <Founded club={founded} name={name.trim()} />
  return (
    <form onSubmit={submit} className="pb-4">
      <TextField label={c.name} value={name} onChange={(event) => setName(event.target.value)} placeholder={c.namePlaceholder} maxLength={60} autoCapitalize="words" autoFocus />
      <TextField label={c.about} value={about} onChange={(event) => setAbout(event.target.value)} placeholder={c.aboutPlaceholder} maxLength={500} />
      <section className="mt-6">
        <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{c.visibility}</p>
        <ChoiceList
          label={c.visibility}
          options={[
            { value: "closed", title: c.closed, subtitle: c.closedHint },
            { value: "public", title: c.public, subtitle: c.publicHint },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
      </section>
      {guest.fields}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Button type="submit" disabled={!ready || busy} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {busy ? c.submitting : c.submit}
      </Button>
      {guest.dialog}
    </form>
  )
}

// The club is there: invite members now, or go to the club.
function Founded({ club, name }: { club: string; name: string }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const nav = useNav()
  const { view } = useClub(club)
  const [inviting, setInviting] = useState(false)
  const openClub = () => nav.replaceTop(CLUB_SCREENS.view, { club, name })
  return (
    <div className="pb-4">
      <InlineStatus tone="success" className="mt-6">
        <span className="block font-semibold">{tx.create.foundedTitle}</span>
        {tx.create.foundedText}
      </InlineStatus>
      <Button onClick={() => setInviting(true)} disabled={!view?.state} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {tx.create.invite}
      </Button>
      <Button variant="ghost" onClick={openClub} className="mt-2 h-12 w-full rounded-2xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
        {tx.create.later}
      </Button>
      {view?.state && (
        <InviteSheet
          view={view}
          state={view.state}
          open={inviting}
          onOpenChange={(open) => {
            setInviting(open)
            if (!open) openClub()
          }}
        />
      )}
    </div>
  )
}
