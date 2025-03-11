"use client"

import { useTheme } from "next-themes"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: {
    soundEnabled: boolean
    animations: boolean
    doubleOut?: boolean
  }
  onSettingsChange: (settings: { soundEnabled: boolean; animations: boolean; doubleOut?: boolean }) => void
}

export function SettingsDialog({ open, onOpenChange, settings, onSettingsChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] card border border-white/10 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100">
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Sound Effects</Label>
                <div className="text-sm text-muted-foreground">Enable game sounds</div>
              </div>
              <Switch
                checked={settings.soundEnabled}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, soundEnabled: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Animations</Label>
                <div className="text-sm text-muted-foreground">Enable smooth transitions</div>
              </div>
              <Switch
                checked={settings.animations}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, animations: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Double Out</Label>
                <div className="text-sm text-muted-foreground">Must finish on a double</div>
              </div>
              <Switch
                checked={settings.doubleOut ?? true}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, doubleOut: checked })}
              />
            </div>
            <div className="space-y-2">
              <Label>Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger className="w-full bg-secondary/30 border-white/10">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent className="bg-card border border-white/10">
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

