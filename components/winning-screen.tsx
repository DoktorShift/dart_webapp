"use client"

import { useEffect } from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import confetti from "canvas-confetti"
import { Trophy, RotateCcw, Users, TrendingUp, Target } from "lucide-react"

interface WinningScreenProps {
  winner: {
    name: string
    score: number
    rounds: number[]
  }
  onPlayAgain: () => void
  onNewGame: () => void
}

export function WinningScreen({ winner, onPlayAgain, onNewGame }: WinningScreenProps) {
  const average =
    winner.rounds.length > 0
      ? Math.round((winner.rounds.reduce((a, b) => a + b, 0) / winner.rounds.length) * 10) / 10
      : 0

  const highestScore = winner.rounds.length > 0 ? Math.max(...winner.rounds) : 0

  // Trigger confetti animation
  useEffect(() => {
    const duration = 5 * 1000
    const animationEnd = Date.now() + duration
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 }

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min
    }

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now()

      if (timeLeft <= 0) {
        return clearInterval(interval)
      }

      const particleCount = 50 * (timeLeft / duration)

      // since particles fall down, start a bit higher than random
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      })
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      })
    }, 250)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="card max-w-md w-full">
        <CardContent className="p-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="mb-8"
          >
            <Trophy className="w-16 h-16 mx-auto text-yellow-500" />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-3xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-yellow-600">
              {winner.name} Wins!
            </h2>
            <div className="flex justify-center gap-6 mb-8">
              <div className="flex items-center">
                <TrendingUp className="w-4 h-4 mr-1 text-primary" />
                <span className="text-muted-foreground">Avg: {average}</span>
              </div>
              <div className="flex items-center">
                <Target className="w-4 h-4 mr-1 text-primary" />
                <span className="text-muted-foreground">High: {highestScore}</span>
              </div>
            </div>

            <div className="grid gap-4">
              <Button onClick={onPlayAgain} size="lg" className="w-full">
                <RotateCcw className="w-4 h-4 mr-2" />
                Play Again
              </Button>
              <Button
                variant="outline"
                onClick={onNewGame}
                size="lg"
                className="w-full bg-secondary/30 border-white/10 hover:bg-secondary/50"
              >
                <Users className="w-4 h-4 mr-2" />
                New Players
              </Button>
            </div>
          </motion.div>
        </CardContent>
      </Card>
    </div>
  )
}

