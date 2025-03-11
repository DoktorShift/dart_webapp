"use client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Target, Settings, Clock, TargetIcon } from "lucide-react"
import { GAME_MODES } from "@/types/game-modes"

interface WelcomeScreenProps {
  onGameSelect: (mode: string) => void
  onSettingsOpen: () => void
}

export function WelcomeScreen({ onGameSelect, onSettingsOpen }: WelcomeScreenProps) {
  const getIcon = (type: string) => {
    switch (type) {
      case "clock":
        return <Clock className="w-12 h-12 mx-auto mb-4 text-primary opacity-90" />
      case "cricket":
        return <TargetIcon className="w-12 h-12 mx-auto mb-4 text-primary opacity-90" />
      default:
        return <Target className="w-12 h-12 mx-auto mb-4 text-primary opacity-90" />
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600">
          Dart Scorer Pro
        </h1>
        <p className="text-muted-foreground text-lg">Select a game mode to begin</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 max-w-4xl w-full mb-12">
        {GAME_MODES.map((mode) => (
          <Card
            key={mode.id}
            className="card cursor-pointer transition-all duration-300 hover:translate-y-[-4px]"
            onClick={() => onGameSelect(mode.id)}
          >
            <CardContent className="p-6 text-center">
              {getIcon(mode.type)}
              <h2 className="text-xl font-semibold mb-2">{mode.name}</h2>
              <p className="text-sm text-muted-foreground">{mode.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        variant="outline"
        onClick={onSettingsOpen}
        className="bg-secondary/20 hover:bg-secondary/40 border border-white/5"
      >
        <Settings className="w-4 h-4 mr-2" />
        Settings
      </Button>
    </div>
  )
}

