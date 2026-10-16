"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { createProfile } from "@/components/profile/create-profile"
import { pictureProblem, ProfileFields } from "@/components/profile/profile-fields"
import { useSignInGuard } from "@/components/profile/sign-in-guard"
import { useClaimablePlayers } from "@/components/profile/use-profile"
import { seatName } from "@/lib/storage/players"

const NOBODY = "nobody"

// "Profil anlegen" from the Profile tab. Whose games on this device become the profile's is a
// choice, never guessed from a name; players linked to another profile aren't offered. Done,
// the Profile tab shows the new profile.
export default function CreateScreen() {
  const tx = useAreaT(PROFILE_TEXTS)
  const c = tx.create
  const f = tx.form
  const nav = useNav()
  const { candidates, loaded } = useClaimablePlayers()
  const { signIn, dialog } = useSignInGuard()
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
      if (await signIn((options) => createProfile({ name, picture, claim: chosen?.playerId ? { playerId: chosen.playerId } : null }, options))) nav.popToRoot("profile")
      else setBusy(false)
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
              ...candidates.map((s) => ({ value: s.playerId as string, title: s.name, subtitle: tx.gamesCount(s.games) })),
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
      <ProfileFields
        seed={name || "blueline"}
        name={name}
        // The board keeps the chosen player's name, or takes as much of a new one as a seat holds.
        nameHint={chosen ? (name.trim() !== chosen.name ? c.boardStays(chosen.name) : undefined) : seatName(name) !== name.trim() ? c.boardShort(seatName(name)) : undefined}
        onName={setName}
        picture={picture}
        onPicture={setPicture}
      />
      {failed && (
        <InlineStatus tone="error" className="mt-4">
          {f.failed}
        </InlineStatus>
      )}
      <Button type="submit" disabled={!ready || busy} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {busy ? f.creating : f.create}
      </Button>
      {dialog}
    </form>
  )
}
