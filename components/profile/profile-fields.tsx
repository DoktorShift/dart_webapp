"use client"

import { Avatar } from "@/components/ui/avatar"
import { TextField } from "@/components/ui/text-field"
import { useT } from "@/components/i18n-provider"
import { MAX_PROFILE_NAME } from "@/lib/profile/metadata"
import { safeImageUrl } from "@/lib/shell/avatar"

// Name and picture of a profile, with a preview of exactly what others will see and the promise
// that games stay private (PLAN.md: confirm name and picture before anything is published).
// The name may be longer than a seat's 16 characters; game tiles fit it without cutting it off.

export const pictureProblem = (picture: string) => picture.trim() !== "" && !safeImageUrl(picture)

export function ProfileFields({
  seed,
  name,
  onName,
  picture,
  onPicture,
}: {
  seed: string
  name: string
  onName: (name: string) => void
  picture: string
  onPicture: (picture: string) => void
}) {
  const t = useT()
  const f = t.profile.form
  const shown = safeImageUrl(picture)
  return (
    <>
      <TextField
        label={f.name}
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder={f.namePlaceholder}
        maxLength={MAX_PROFILE_NAME}
        autoComplete="nickname"
        autoCapitalize="words"
        enterKeyHint="next"
      />
      <TextField
        label={f.picture}
        value={picture}
        onChange={(e) => onPicture(e.target.value)}
        placeholder={f.picturePlaceholder}
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        hint={f.pictureHint}
        error={pictureProblem(picture) ? f.pictureInvalid : undefined}
      />
      <div className="mt-6 flex items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
        <Avatar seed={seed} name={name.trim() || undefined} src={shown} size={48} />
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{name.trim() || t.profile.unnamed}</p>
          <p className="text-[0.8125rem] leading-snug text-muted-foreground">{f.visible}</p>
        </div>
      </div>
    </>
  )
}
