"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronLeft, ChevronRight, TrendingUp, Target, Share2 } from "lucide-react"
import { useSwipeable } from "react-swipeable"

interface MobilePlayerCardsProps {
  players: Array<{
    id: number
    name: string
    score: number
    rounds: number[]
    average?: number
  }>
  currentPlayerIndex: number
  onNameChange: (id: number, name: string) => void
  onPlayerChange: (index: number) => void
  onShare?: (player: any) => void
}

export function MobilePlayerCards({
  players,
  currentPlayerIndex,
  onNameChange,
  onPlayerChange,
  onShare,
}: MobilePlayerCardsProps) {
  const [showStats, setShowStats] = useState(false)

  const handleShare = (player: any) => {
    if (onShare) {
      onShare(player)
    } else {
      // Fallback if no share handler provided
      if (navigator.share) {
        navigator
          .share({
            title: "Dart Scorer Pro",
            text: `${player.name} is playing darts with a score of ${player.score}!`,
            url: window.location.href,
          })
          .catch((err) => console.error("Error sharing:", err))
      }
    }
  }

  // Calculate stats for current player
  const currentPlayer = players[currentPlayerIndex]
  const average =
    currentPlayer.rounds.length > 0
      ? Math.round((currentPlayer.rounds.reduce((a, b) => a + b, 0) / currentPlayer.rounds.length) * 10) / 10
      : 0
  const highestScore = currentPlayer.rounds.length > 0 ? Math.max(...currentPlayer.rounds) : 0

  // Swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (currentPlayerIndex < players.length - 1) {
        onPlayerChange(currentPlayerIndex + 1)
      }
    },
    onSwipedRight: () => {
      if (currentPlayerIndex > 0) {
        onPlayerChange(currentPlayerIndex - 1)
      }
    },
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
  })

  return (
    <div className="relative pb-4">
      <div className="flex justify-between items-center mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPlayerChange(currentPlayerIndex > 0 ? currentPlayerIndex - 1 : players.length - 1)}
          disabled={players.length <= 1}
          className="text-muted-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <div className="flex space-x-2 justify-center">
          {players.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full ${index === currentPlayerIndex ? "bg-primary" : "bg-muted"}`}
              onClick={() => onPlayerChange(index)}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPlayerChange(currentPlayerIndex < players.length - 1 ? currentPlayerIndex + 1 : 0)}
          disabled={players.length <= 1}
          className="text-muted-foreground"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      <div {...swipeHandlers} className="overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPlayerIndex}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <Card className="card active">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <Input
                    className="text-lg font-semibold bg-transparent border-none focus:outline-none hover:bg-muted/20 transition-colors"
                    value={currentPlayer.name}
                    onChange={(e) => onNameChange(currentPlayer.id, e.target.value)}
                  />

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleShare(currentPlayer)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex flex-col items-center">
                  <div className="text-6xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100">
                    {currentPlayer.score}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowStats(!showStats)}
                    className="mb-3 text-sm text-muted-foreground"
                  >
                    {showStats ? "Hide Stats" : "Show Stats"}
                  </Button>

                  <AnimatePresence>
                    {showStats && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="w-full space-y-2 mb-3"
                      >
                        <div className="flex justify-between items-center p-2 bg-secondary/20 rounded-lg">
                          <div className="flex items-center">
                            <TrendingUp className="w-4 h-4 mr-2 text-primary" />
                            <span>Average</span>
                          </div>
                          <span className="font-semibold">{average || "-"}</span>
                        </div>

                        <div className="flex justify-between items-center p-2 bg-secondary/20 rounded-lg">
                          <div className="flex items-center">
                            <Target className="w-4 h-4 mr-2 text-primary" />
                            <span>Highest</span>
                          </div>
                          <span className="font-semibold">{highestScore || "-"}</span>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {currentPlayer.rounds.slice(-3).map((round, i) => (
                            <div key={i} className="p-2 bg-secondary/20 rounded-lg text-center">
                              <div className="text-xs text-muted-foreground">Throw {i + 1}</div>
                              <div className="text-lg font-semibold">{round}</div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {currentPlayer.score <= 170 && (
                    <div className="mt-2 text-sm text-primary font-medium">Checkout possible</div>
                  )}

                  <div className="mt-3 flex justify-center">
                    <div className="flex space-x-3">
                      {[0, 1, 2].map((attempt) => (
                        <div
                          key={attempt}
                          className={`w-2 h-2 rounded-full ${
                            currentPlayer.rounds.length % 3 > attempt ? "bg-gray-500" : "bg-primary"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

