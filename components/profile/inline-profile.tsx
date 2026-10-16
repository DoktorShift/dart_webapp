"use client"

import { useState, type ReactNode } from "react"
import { ChoiceList } from "@/components/ui/choice-list"
import { TextField } from "@/components/ui/text-field"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { createProfile } from "@/components/profile/create-profile"
import { useSignInGuard } from "@/components/profile/sign-in-guard"
import { useClaimablePlayers } from "@/components/profile/use-profile"
import { useSession } from "@/lib/profile/session"
import { MAX_PROFILE_NAME } from "@/lib/profile/metadata"

const NOBODY = "nobody"

// Founding or joining a club, registering for or creating a tournament needs a profile. A guest
// gets one right where they are, with one name (design rules: low friction, no key step),
// instead of being sent to the Profile tab and losing what they were looking at. Whose games on this device become the profile's stays
// a choice when there are any (the profile area's rule: never guessed from a name).
//
//   const guest = useInlineProfile()
//   … {guest.fields} … <Button disabled={!guest.ready} onClick={() => guest.ensure().then(ok => ok && …)}>
//   {guest.dialog}
export function useInlineProfile(): { needed: boolean; ready: boolean; fields: ReactNode; dialog: ReactNode; ensure: () => Promise<boolean> } {
  const session = useSession()
  const px = useAreaT(PROFILE_TEXTS)
  const { candidates, loaded } = useClaimablePlayers()
  const { signIn, dialog } = useSignInGuard()
  const [name, setName] = useState("")
  const [choice, setChoice] = useState<string | null>(null)

  const needed = session === null
  const chosen = choice && choice !== NOBODY ? (candidates.find((c) => c.playerId === choice) ?? null) : null
  const ready = !needed || (loaded && name.trim() !== "" && (candidates.length === 0 || choice !== null))

  // True once a profile is there (made now, or signed in meanwhile); false when the person kept
  // another profile that turned out to be signed in.
  const ensure = async () => {
    if (!needed) return true
    return signIn((options) => createProfile({ name, picture: "", claim: chosen?.playerId ? { playerId: chosen.playerId } : null }, options))
  }

  const fields =
    needed && loaded ? (
      <section>
        {candidates.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{px.create.who}</p>
            <ChoiceList
              label={px.create.who}
              options={[
                ...candidates.map((c) => ({ value: c.playerId as string, title: c.name, subtitle: px.gamesCount(c.games) })),
                { value: NOBODY, title: px.create.nobody, subtitle: px.create.nobodyHint },
              ]}
              value={choice}
              onChange={(value) => {
                setChoice(value)
                const player = candidates.find((c) => c.playerId === value)
                if (player && !name.trim()) setName(player.name)
              }}
            />
          </div>
        )}
        <TextField
          label={px.inline.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={px.inline.namePlaceholder}
          maxLength={MAX_PROFILE_NAME}
          autoComplete="name"
          autoCapitalize="words"
          hint={px.inline.hint}
        />
      </section>
    ) : null

  return { needed, ready, fields, dialog, ensure }
}
