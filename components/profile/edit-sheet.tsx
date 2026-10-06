"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
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
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { pictureProblem, ProfileFields } from "@/components/profile/profile-fields"
import { signerProblem, SignerConfirmation } from "@/components/profile/signer-status"
import type { OwnProfile } from "@/components/profile/use-profile"
import { addProfilePlayer } from "@/lib/profile/claim"
import { metadataTemplate, type MetadataChange } from "@/lib/profile/metadata"
import { OWN } from "@/lib/profile/own-events"
import { safeImageUrl } from "@/lib/shell/avatar"
import { renamePlayer } from "@/lib/storage/players"
import { publishOwn } from "@/lib/sync/publish"

// "Bearbeiten": the name at the board and the public picture. The name in BlueLine is the
// profile's player here; whether the public profile (which other apps show too) changes with it
// is asked, never done on the side (PLAN.md "Identitäten und Signer"). The picture exists only
// publicly, so changing it publishes it, as the form says.
export function EditSheet({ own, open, onOpenChange }: { own: OwnProfile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const e = tx.edit
  const [name, setName] = useState(own.name ?? "")
  const [picture, setPicture] = useState(own.metadata.picture ?? "")
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const nameChanged = name.trim() !== (own.name ?? "")
  const pictureChanged = (safeImageUrl(picture) ?? "") !== (own.metadata.picture ?? "")
  const ready = name.trim() !== "" && !pictureProblem(picture) && (nameChanged || pictureChanged)

  const save = async (publicName: boolean) => {
    setAsking(false)
    setBusy(true)
    setProblem(null)
    try {
      if (nameChanged) {
        if (own.player) await renamePlayer(own.player.id, name)
        else await addProfilePlayer(own.session.pubkey, name)
      }
      const change: MetadataChange = {
        ...(publicName && name.trim() !== own.metadata.name ? { name: name.trim() } : {}),
        ...(pictureChanged ? { picture: safeImageUrl(picture) } : {}),
      }
      if (Object.keys(change).length > 0) await publishOwn([metadataTemplate(change, own.events?.get(OWN.metadata))])
      onOpenChange(false)
    } catch (error) {
      setProblem(signerProblem(tx, error))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    // A new name the public profile doesn't have yet: ask. Otherwise nothing to decide.
    if (nameChanged && name.trim() !== own.metadata.name) setAsking(true)
    else void save(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={e.title}>
        <form onSubmit={submit} className="flex min-h-0 flex-col overscroll-contain xshort:overflow-y-auto">
          <div className="min-h-0 overflow-y-auto overscroll-contain pb-4 xshort:shrink-0 xshort:overflow-visible">
            <ProfileFields seed={own.session.pubkey} name={name} onName={setName} picture={picture} onPicture={setPicture} />
            <SignerConfirmation />
            {problem && (
              <InlineStatus tone="error" className="mt-4">
                {problem}
              </InlineStatus>
            )}
          </div>
          <Button type="submit" disabled={!ready || busy} className="mt-2 h-14 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
            {e.save}
          </Button>
        </form>
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </Sheet>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{e.publicTitle}</AlertDialogTitle>
            <AlertDialogDescription>{e.publicDescription(name.trim())}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11" onClick={() => void save(false)}>
              {e.publicNo}
            </AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => void save(true)}>
              {e.publicYes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
