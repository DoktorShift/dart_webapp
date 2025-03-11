"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Check, X, Target, Circle, CircleDot } from "lucide-react"
import { cn } from "@/lib/utils"

interface ScoreInputProps {
  onScoreSubmit: (score: number) => void
  onUndo: () => void
  canUndo: boolean
  currentScore: number
}

type Multiplier = 1 | 2 | 3

export function ScoreInput({ onScoreSubmit, onUndo, canUndo, currentScore }: ScoreInputProps) {
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [multiplier, setMultiplier] = useState<Multiplier>(1)
  const [error, setError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")

  const handleNumberClick = (num: number) => {
    setSelectedNumber(num)
    setError("")
    setSuccessMessage("")
  }

  const handleMultiplierClick = (mult: Multiplier) => {
    setMultiplier(mult)
    setError("")
    setSuccessMessage("")
  }

  const clearSelection = useCallback(() => {
    setSelectedNumber(null)
    setMultiplier(1)
    setError("")
    setSuccessMessage("")
  }, [])

  const validateThrow = useCallback((newScore: number, isDouble: boolean): { valid: boolean; message: string } => {
    if (newScore < 0) {
      return { valid: false, message: "Bust! Score too high" }
    }

    if (newScore === 1) {
      return { valid: false, message: "Bust! Cannot leave a score of 1" }
    }

    if (newScore === 0 && !isDouble) {
      return { valid: false, message: "Must finish on a double" }
    }

    return { valid: true, message: "" }
  }, [])

  const handleSubmit = useCallback(() => {
    if (selectedNumber === null) return

    const score = selectedNumber * multiplier
    const newScore = currentScore - score

    // Validate the throw
    const validation = validateThrow(newScore, multiplier === 2)

    if (!validation.valid) {
      setError(validation.message)
      return
    }

    if (newScore === 0) {
      setSuccessMessage("Game shot! 🎯")
    }

    onScoreSubmit(score)
    setSelectedNumber(null)
    setMultiplier(1)
    setError("")

    // Clear success message after a delay
    if (newScore === 0) {
      setTimeout(() => {
        setSuccessMessage("")
      }, 2000)
    }
  }, [selectedNumber, multiplier, currentScore, onScoreSubmit, validateThrow])

  const handleBull = useCallback(
    (isDouble: boolean) => {
      const score = isDouble ? 50 : 25
      const newScore = currentScore - score

      // Validate the throw
      const validation = validateThrow(newScore, isDouble)

      if (!validation.valid) {
        setError(validation.message)
        return
      }

      if (newScore === 0) {
        setSuccessMessage("Game shot! 🎯")
      }

      onScoreSubmit(score)
      setSelectedNumber(null)
      setMultiplier(1)
      setError("")

      // Clear success message after a delay
      if (newScore === 0) {
        setTimeout(() => {
          setSuccessMessage("")
        }, 2000)
      }
    },
    [currentScore, onScoreSubmit, validateThrow],
  )

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const num = Number(e.key)
      if (!isNaN(num) && num >= 1 && num <= 20) {
        handleNumberClick(num)
      } else if (e.key === "Enter" && selectedNumber !== null) {
        handleSubmit()
      } else if (e.key === "Escape") {
        clearSelection()
      }
    }

    window.addEventListener("keypress", handleKeyPress)
    return () => window.removeEventListener("keypress", handleKeyPress)
  }, [selectedNumber, multiplier, clearSelection, handleSubmit])

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-secondary/20 backdrop-blur-md border-t border-white/5 shadow-lg z-20">
      <Card className="max-w-2xl mx-auto card">
        <CardContent className="p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="space-y-3">
              <div className="flex gap-2">
                {[1, 2, 3].map((mult) => (
                  <Button
                    key={mult}
                    variant={multiplier === mult ? "default" : "outline"}
                    className={cn("flex-1", {
                      "bg-primary text-primary-foreground": multiplier === mult,
                      "bg-secondary/30 border-white/10": multiplier !== mult,
                    })}
                    onClick={() => handleMultiplierClick(mult as Multiplier)}
                  >
                    {mult === 1 ? "Single" : mult === 2 ? "Double" : "Triple"}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                  <Button
                    key={num}
                    variant={selectedNumber === num ? "default" : "outline"}
                    className={cn({
                      "bg-primary text-primary-foreground": selectedNumber === num,
                      "bg-secondary/30 border-white/10 hover:bg-secondary/50": selectedNumber !== num,
                    })}
                    onClick={() => handleNumberClick(num)}
                  >
                    {num}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 bg-secondary/30 border-white/10 hover:bg-secondary/50"
                  onClick={() => handleBull(false)}
                >
                  <Circle className="w-4 h-4 mr-2" />
                  Bull (25)
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 bg-secondary/30 border-white/10 hover:bg-secondary/50"
                  onClick={() => handleBull(true)}
                >
                  <CircleDot className="w-4 h-4 mr-2" />
                  D-Bull (50)
                </Button>
              </div>
              <div className="h-[calc(100%-2.75rem)] flex flex-col gap-2">
                <div className="flex-1 flex items-center justify-center p-4 rounded-lg bg-secondary/30 border border-white/5">
                  {selectedNumber ? (
                    <motion.div
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      className="text-4xl font-bold tabular-nums bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100"
                    >
                      {selectedNumber * multiplier}
                    </motion.div>
                  ) : (
                    <Target className="w-12 h-12 text-muted-foreground opacity-50" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={clearSelection}
                    className="bg-secondary/30 border-white/10 hover:bg-secondary/50"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={selectedNumber === null}
                    className={selectedNumber !== null ? "" : "opacity-50"}
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Enter
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onUndo}
              disabled={!canUndo}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex-1 text-sm text-destructive font-medium"
                >
                  {error}
                </motion.div>
              )}
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex-1 text-sm text-green-500 font-medium"
                >
                  {successMessage}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

