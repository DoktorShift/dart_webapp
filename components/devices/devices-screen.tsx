"use client"

import { useEffect, useState, type FormEvent } from "react"
import { CircleHelp, MonitorSmartphone } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
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
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { DEVICES_SCREENS } from "@/components/devices/screens"
import { useBackupStatus } from "@/components/devices/use-backup"
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import { deviceName, MAX_DEVICE_NAME } from "@/lib/devices/device-name"
import type { DeviceEntry, DeviceList } from "@/lib/devices/list"
import { useSession, type Session } from "@/lib/profile/session"
import { isSecured } from "@/lib/recovery/status"
import { SCREENS } from "@/lib/shell/registry"
import { useSyncStatus } from "@/lib/sync/status"

// Profil › Geräte (P2.03): the profile's devices as the person keeps them (lib/devices/list.ts),
// "Eigenes Gerät hinzufügen", and what to do about a lost one. The list is an overview, and
// says so: removing a device here takes nothing from it.
export default function DevicesScreen() {
  const session = useSession()
  if (!session) return null
  return <Devices key={session.pubkey} session={session} />
}

const loadList = () => import("@/lib/devices/list")

function Devices({ session }: { session: Session }) {
  const t = useT()
  const l = useAreaT(DEVICES_TEXTS).list
  const nav = useNav()
  const { pubkey } = session
  const [list, setList] = useState<DeviceList | null>(null)
  const [round, setRound] = useState(0)
  const [editing, setEditing] = useState<DeviceEntry | null>(null)
  const [lostOpen, setLostOpen] = useState(false)

  // The first device of a profile puts itself in when the list first opens; then the list as
  // the relays have it. Again after each sync here (the first one brings the data key and this
  // device's id, lib/devices/list.ts), and whenever this device gave the profile to another one.
  const synced = useSyncStatus().endedAt
  useEffect(() => {
    let alive = true
    void loadList()
      .then(async ({ addThisDevice, loadDeviceList }) => {
        await addThisDevice(pubkey, deviceName()).catch(() => {})
        return loadDeviceList(pubkey)
      })
      .then(
        (next) => alive && setList(next),
        () => alive && setList({ entries: [], thisDevice: "", state: "unavailable", available: false, arriving: [] }),
      )
    return () => {
      alive = false
    }
  }, [pubkey, round, synced])
  useEffect(() => {
    let alive = true
    let stop = () => {}
    void loadList().then(({ onDeviceAdded }) => {
      if (alive) stop = onDeviceAdded(() => setRound((n) => n + 1))
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  const reload = () => setRound((n) => n + 1)
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(t.intl, { day: "numeric", month: "long", year: "numeric" })
  const footer = !list ? undefined : !list.available ? l.notYet : list.state === "complete" ? undefined : list.state === "partial" ? l.partial : l.unavailable

  return (
    <>
      <Group title={l.devices} footer={footer}>
        {!list ? (
          <ListRow title={l.loading} />
        ) : (
          <>
            {list.entries.map((device) => (
              <ListRow key={device.id} title={device.name} subtitle={device.id === list.thisDevice ? l.thisDevice : l.since(date(device.added))} onClick={() => setEditing(device)} />
            ))}
            {list.arriving.map((name, i) => (
              <ListRow key={`arriving:${i}`} title={name} subtitle={l.arriving} />
            ))}
          </>
        )}
      </Group>

      <Group>
        <ListRow icon={MonitorSmartphone} iconTone="green" title={l.add} subtitle={l.addHint} onClick={() => nav.push(SCREENS.devicesPair)} />
        <ListRow icon={CircleHelp} iconTone="gray" title={l.lost} onClick={() => setLostOpen(true)} />
      </Group>
      <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{l.footer}</p>

      {editing && <EditSheet key={editing.id} pubkey={pubkey} device={editing} isThis={editing.id === list?.thisDevice} onClose={() => setEditing(null)} onChanged={reload} />}
      <LostSheet session={session} open={lostOpen} onClose={() => setLostOpen(false)} />
    </>
  )
}

// "Gerät verloren?": the one honest fact first, then only the steps that apply to this profile
// (a signer app ends the connection there; a profile not yet secured is offered the backup).
function LostSheet({ session, open, onClose }: { session: Session; open: boolean; onClose: () => void }) {
  const l = useAreaT(DEVICES_TEXTS).list
  const nav = useNav()
  const status = useBackupStatus(session.pubkey)
  const local = session.kind === "local"
  const lost = l.lostSteps
  const steps = local ? [lost.remove, lost.newProfile] : [lost.signerStep, lost.remove]
  const unsecured = local && status !== undefined && !isSecured(status)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={l.lostTitle}>
      <SheetBody>
        <p className="text-[1.0625rem] font-semibold leading-snug">{local ? lost.local : lost.signer}</p>
        <ol className="mt-3 grid gap-3 pl-5 text-[1.0625rem] leading-snug [&>li]:list-decimal">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
          {unsecured && <li>{lost.backup}</li>}
        </ol>
      </SheetBody>
      <div className="mt-4 grid shrink-0 gap-2">
        <Button onClick={onClose} className="h-12 w-full rounded-2xl text-[1.0625rem] font-semibold">
          {l.lostDone}
        </Button>
        {unsecured && (
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
              nav.push(DEVICES_SCREENS.backup)
            }}
            className="h-12 w-full rounded-2xl text-[1.0625rem] text-primary"
          >
            {lost.backupAction}
          </Button>
        )}
      </div>
    </Sheet>
  )
}

// One device: a new name, or out of the list (with the honest word that the device keeps what
// it has). The device in hand isn't removed here: it signs out in Profile.
function EditSheet({ pubkey, device, isThis, onClose, onChanged }: { pubkey: string; device: DeviceEntry; isThis: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT()
  const l = useAreaT(DEVICES_TEXTS).list
  const [name, setName] = useState(device.name)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const run = async (change: (list: Awaited<ReturnType<typeof loadList>>) => Promise<void>) => {
    setBusy(true)
    setFailed(null)
    const list = await loadList()
    try {
      await change(list)
      onChanged()
      onClose()
    } catch (error) {
      setFailed(error instanceof list.DeviceListError && error.problem === "offline" ? l.offline : l.failed)
      setBusy(false)
    }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || name.trim() === device.name) return onClose()
    void run(({ renameDevice }) => renameDevice(pubkey, device.id, name))
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={device.name} description={isThis ? l.thisDevice : undefined}>
      <SheetBody>
        <form onSubmit={save}>
          <TextField label={l.nameLabel} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_DEVICE_NAME} autoCapitalize="words" enterKeyHint="done" className="mt-2" />
          {failed && (
            <InlineStatus tone="error" className="mt-4">
              {failed}
            </InlineStatus>
          )}
          <Button type="submit" disabled={busy || !name.trim()} className="mt-4 h-12 w-full rounded-2xl text-[1.0625rem] font-semibold">
            {busy ? l.saving : l.save}
          </Button>
        </form>
        {isThis ? (
          <p className="mt-3 px-1 pb-1 text-[0.8125rem] leading-snug text-muted-foreground">{l.thisDeviceNote}</p>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)} className="mt-2 h-12 w-full rounded-2xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
            {l.remove}
          </Button>
        )}
      </SheetBody>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{l.removeTitle(device.name)}</AlertDialogTitle>
            <AlertDialogDescription>{l.removeText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void run(({ removeDevice }) => removeDevice(pubkey, device.id))}>
              {l.removeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
