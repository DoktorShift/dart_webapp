"use client"

import { Button } from "@/components/ui/button"
import { Users, Settings, X, Trophy } from "lucide-react"

interface GameHeaderProps {
  gameMode: string
  onStop: () => void
  onSettingsOpen: () => void
  playersCount: number
}

export function GameHeader({ gameMode, onStop, onSettingsOpen, playersCount }: GameHeaderProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 backdrop-blur-sm border border-white/5 shadow-lg mb-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-yellow-500" />
        <span className="text-sm font-medium">{gameMode}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-secondary/30 border border-white/5">
          <Users className="w-3.5 h-3.5" />
          <span className="text-xs">{playersCount}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onSettingsOpen} className="h-8 w-8 hover:bg-secondary/30">
          <Settings className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onStop}
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

