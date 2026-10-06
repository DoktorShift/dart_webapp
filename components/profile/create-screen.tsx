"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { createProfile } from "@/components/profile/create-profile"
import { pictureProblem, ProfileFields } from "@/components/profile/profile-fields"
import { useClaimablePlayers } from "@/components/profile/use-profile"

const NOBODY = "nobody"

// "Profil anlegen" from the Profile tab. Whose games on this device become the profile's is a
// choice, never guessed from a name; players linked to another profile aren't offered. Done,
// the Profile tab shows the new profile.
export default function CreateScreen() {
  const t = useT()
  const c = t.profile.create
  const f = t.profile.form
  const nav = useNav()
  const { candidates, loaded } = useClaimablePlayers()
  const [choice, setChoice] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [picture, setPicture] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const chosen = choice === NOBODY || candidates.length === 0 ? null : (candidates.find((s) => s.playerId === choice) ?? null)
  const ready = (choice !== null || candidates.length === 0) && name.trim() !== "" && !pictureProblem(picture)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await createProfile({ name, picture, claim: chosen?.playerId ? { playerId: chosen.playerId } : null })
      nav.popToRoot("profile")
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  if (!loaded) return null
  return (
    <form onSubmit={submit} className="pb-4">
      {candidates.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{c.who}</p>
          <ChoiceList
            label={c.who}
            options={[
              ...candidates.map((s) => ({ value: s.playerId as string, title: s.name, subtitle: t.profile.gamesCount(s.games) })),
              { value: NOBODY, title: c.nobody, subtitle: c.nobodyHint },
            ]}
            value={choice}
            onChange={(value) => {
              setChoice(value)
              const player = candidates.find((s) => s.playerId === value)
              if (player && !name.trim()) setName(player.name)
            }}
          />
          <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{c.whoHint}</p>
        </section>
      )}
      <ProfileFields seed={name || "blueline"} name={name} onName={setName} picture={picture} onPicture={setPicture} />
      {failed && (
        <InlineStatus tone="error" className="mt-4">
          {f.failed}
        </InlineStatus>
      )}
      <Button type="submit" disabled={!ready || busy} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {busy ? f.creating : f.create}
      </Button>
    </form>
  )
}
