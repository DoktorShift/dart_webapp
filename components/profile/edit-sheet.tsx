"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
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
import { changeBase, lookupOwnEvents, OWN } from "@/lib/profile/own-events"
import { safeImageUrl } from "@/lib/shell/avatar"
import { MAX_SEAT_NAME, renamePlayer, seatName } from "@/lib/storage/players"
import { publishOwn } from "@/lib/sync/publish"

// "Bearbeiten": the name at the board, which is the profile's player here, and the public
// profile (name and picture, which other apps show too). The two are kept apart on purpose: a
// new board name never changes the public profile on the side; where both were the same, it is
// asked (PLAN.md "Identitäten und Signer"). The public profile is looked up again when the sheet
// opens: a change builds on the newest version, and until a version is known (or a relay has
// said there is none) nothing public is saved (lib/profile/own-events.ts).
export function EditSheet({ own, open, onOpenChange }: { own: OwnProfile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const e = tx.edit
  const { pubkey } = own.session
  const [boardName, setBoardName] = useState(own.player?.name ?? "")
  const [publicName, setPublicName] = useState(own.metadata.name ?? "")
  const [picture, setPicture] = useState(own.metadata.picture ?? "")
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void lookupOwnEvents(pubkey, { again: true })
  }, [pubkey])

  const base = own.events?.get(OWN.metadata) ?? null
  // Without a version here, the public profile can be changed only once a relay has answered.
  const answered = own.lookup?.answered ?? null
  const publicState = base ? "known" : answered === null ? "loading" : answered ? "none" : "failed"
  const publicKnown = publicState === "known" || publicState === "none"

  const boardChanged = seatName(boardName) !== "" && seatName(boardName) !== (own.player?.name ?? "")
  const publicChanged = publicName.trim() !== (own.metadata.name ?? "")
  const pictureChanged = (safeImageUrl(picture) ?? "") !== (own.metadata.picture ?? "")
  const publicChange = publicChanged || pictureChanged
  const ready = !pictureProblem(picture) && (boardChanged || publicChange) && (!publicChange || publicKnown) && (!publicChanged || publicName.trim() !== "")

  const save = async (publicFollows: boolean) => {
    setAsking(false)
    setBusy(true)
    setProblem(null)
    try {
      if (boardChanged) {
        if (own.player) await renamePlayer(own.player.id, seatName(boardName))
        else await addProfilePlayer(pubkey, boardName)
      }
      const name = publicChanged ? publicName.trim() : publicFollows ? seatName(boardName) : undefined
      const change: MetadataChange = { ...(name !== undefined ? { name } : {}), ...(pictureChanged ? { picture: safeImageUrl(picture) } : {}) }
      if (Object.keys(change).length > 0) await publishOwn([metadataTemplate(change, await changeBase(pubkey, OWN.metadata))])
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
    // A new board name while the public name is still the old board name: ask whether the public
    // profile follows. Otherwise there is nothing to decide.
    const sameSoFar = (own.metadata.name ?? "") === (own.player?.name ?? "")
    if (boardChanged && !publicChanged && publicKnown && sameSoFar) setAsking(true)
    else void save(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={e.title}>
        <form onSubmit={submit} className="flex min-h-0 flex-col overscroll-contain xshort:overflow-y-auto">
          <div className="min-h-0 overflow-y-auto overscroll-contain pb-4 xshort:shrink-0 xshort:overflow-visible">
            <TextField
              label={e.boardName}
              value={boardName}
              onChange={(event) => setBoardName(event.target.value)}
              placeholder={own.player?.name ?? seatName(publicName)}
              maxLength={MAX_SEAT_NAME}
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="next"
              hint={e.boardHint(MAX_SEAT_NAME)}
            />
            <ProfileFields seed={pubkey} name={publicName} nameHint={e.publicHint} onName={setPublicName} picture={picture} onPicture={setPicture} />
            {publicState === "loading" && (
              <p role="status" className="mt-4 px-4 text-[0.9375rem] text-muted-foreground">
                {e.loading}
              </p>
            )}
            {publicState === "none" && <InlineStatus className="mt-4">{e.notFound}</InlineStatus>}
            {publicState === "failed" && (
              <div className="mt-4">
                <InlineStatus tone="error">{e.notLoaded}</InlineStatus>
                <Button variant="secondary" onClick={() => void lookupOwnEvents(pubkey, { again: true })} className="mt-2 h-11 rounded-xl px-5 text-[1.0625rem]">
                  {tx.public.retry}
                </Button>
              </div>
            )}
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
            <AlertDialogDescription>{e.publicDescription(seatName(boardName))}</AlertDialogDescription>
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
