"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Crown, TrendingUp, Target } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface PlayerCardProps {
  player: {
    id: number
    name: string
    score: number
    rounds: number[]
    average?: number
  }
  isActive: boolean
  onNameChange: (name: string) => void
  onRemove: () => void
  isWinner: boolean
}

export function PlayerCard({ player, isActive, onNameChange, onRemove, isWinner }: PlayerCardProps) {
  const [average, setAverage] = useState(0)
  const [highestScore, setHighestScore] = useState(0)
  const [scoreChange, setScoreChange] = useState<number | null>(null)

  useEffect(() => {
    if (player.rounds.length > 0) {
      const avg = player.rounds.reduce((a, b) => a + b, 0) / player.rounds.length
      setAverage(Math.round(avg * 10) / 10)

      const highest = Math.max(...player.rounds)
      setHighestScore(highest)

      // Animate score change
      if (player.rounds.length > 0) {
        setScoreChange(player.rounds[player.rounds.length - 1])
        setTimeout(() => setScoreChange(null), 2000)
      }
    }
  }, [player.rounds])

  return (
    <Card className={`player-card card ${isActive ? "active" : ""} ${isActive ? "shadow-lg" : "shadow"}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Input
              className="text-lg font-semibold bg-transparent border-none focus:outline-none hover:bg-muted/20 transition-colors w-40 md:w-auto"
              value={player.name}
              onChange={(e) => onNameChange(e.target.value)}
            />
            {isWinner && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-yellow-500">
                <Crown className="w-6 h-6" />
              </motion.div>
            )}
            {isActive && <div className="w-3 h-3 rounded-full bg-primary shadow-sm" />}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <div className="relative">
              <div className="text-5xl font-bold mb-2">{player.score}</div>
              <AnimatePresence>
                {scoreChange !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute -top-4 left-0 text-sm font-medium text-green-500"
                  >
                    -{scoreChange}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <div className="flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" />
                <span>Avg: {average || "-"}</span>
              </div>
              <div className="flex items-center">
                <Target className="w-3 h-3 mr-1" />
                <span>High: {highestScore || "-"}</span>
              </div>
            </div>
          </div>
          <div className="space-y-1 text-right">
            <AnimatePresence>
              {player.rounds.slice(-3).map((round, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="text-lg font-medium"
                >
                  {round}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {isActive && player.score <= 170 && (
          <div className="mt-4 text-sm text-primary font-medium">Checkout possible</div>
        )}

        {isActive && (
          <div className="mt-4 flex justify-center">
            <div className="flex space-x-3">
              {[0, 1, 2].map((attempt) => (
                <div
                  key={attempt}
                  className={`w-2 h-2 rounded-full ${
                    player.rounds.length % 3 > attempt ? "bg-gray-500" : "bg-primary"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

