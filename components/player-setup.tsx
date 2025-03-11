"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { User, Plus, Minus, ArrowRight } from "lucide-react"

interface PlayerSetupProps {
  onComplete: (players: Array<{ id: number; name: string }>) => void
  onBack: () => void
}

export function PlayerSetup({ onComplete, onBack }: PlayerSetupProps) {
  const [players, setPlayers] = useState([
    { id: 1, name: "Player 1" },
    { id: 2, name: "Player 2" },
  ])

  const addPlayer = () => {
    if (players.length >= 4) return
    setPlayers([...players, { id: players.length + 1, name: `Player ${players.length + 1}` }])
  }

  const removePlayer = (id: number) => {
    if (players.length <= 2) return
    setPlayers(players.filter((p) => p.id !== id))
  }

  const updatePlayerName = (id: number, name: string) => {
    setPlayers(players.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="max-w-2xl mx-auto p-4 md:p-6"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600">
          Player Setup
        </h2>
        <p className="text-muted-foreground">Add 2-4 players to start the game</p>
      </div>

      <Card className="card mb-6">
        <CardContent className="p-5">
          <div className="space-y-4">
            <AnimatePresence>
              {players.map((player, index) => (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-full bg-secondary/30 flex items-center justify-center">
                    <User className="w-5 h-5" />
                  </div>
                  <Input
                    value={player.name}
                    onChange={(e) => updatePlayerName(player.id, e.target.value)}
                    className="flex-1 bg-secondary/30 border-white/10 focus:ring-primary/20"
                    placeholder="Enter player name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePlayer(player.id)}
                    disabled={players.length <= 2}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <Button
            variant="outline"
            onClick={addPlayer}
            disabled={players.length >= 4}
            className="w-full mt-4 bg-secondary/30 border-white/10 hover:bg-secondary/50"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Player
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="hover:bg-secondary/30">
          Back
        </Button>
        <Button onClick={() => onComplete(players)}>
          Start Game
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </motion.div>
  )
}

