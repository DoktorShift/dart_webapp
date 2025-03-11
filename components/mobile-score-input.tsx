"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Check, X, Target, Circle, CircleDot, ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSwipeable } from "react-swipeable"

interface MobileScoreInputProps {
  onScoreSubmit: (score: number) => void
  onUndo: () => void
  canUndo: boolean
  currentScore: number
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  attemptsCount: number
}

type Multiplier = 1 | 2 | 3

export function MobileScoreInput({
  onScoreSubmit,
  onUndo,
  canUndo,
  currentScore,
  isExpanded,
  onExpandedChange,
  attemptsCount,
}: MobileScoreInputProps) {
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [multiplier, setMultiplier] = useState<Multiplier>(1)
  const [error, setError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")

  // Haptic feedback function
  const triggerHaptic = () => {
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(50)
    }
  }

  const handleNumberClick = (num: number) => {
    triggerHaptic()
    setSelectedNumber(num)
    setError("")
    setSuccessMessage("")
  }

  const handleMultiplierClick = (mult: Multiplier) => {
    triggerHaptic()
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

    triggerHaptic()
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

    // Collapse the keyboard after submission
    if (attemptsCount >= 2) {
      onExpandedChange(false)
    }

    // Clear success message after a delay
    if (newScore === 0) {
      setTimeout(() => {
        setSuccessMessage("")
      }, 2000)
    }
  }, [selectedNumber, multiplier, currentScore, onScoreSubmit, validateThrow, attemptsCount, onExpandedChange])

  const handleBull = useCallback(
    (isDouble: boolean) => {
      triggerHaptic()
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

      // Collapse the keyboard after submission
      if (attemptsCount >= 2) {
        onExpandedChange(false)
      }

      // Clear success message after a delay
      if (newScore === 0) {
        setTimeout(() => {
          setSuccessMessage("")
        }, 2000)
      }
    },
    [currentScore, onScoreSubmit, validateThrow, attemptsCount, onExpandedChange],
  )

  // Swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedUp: () => onExpandedChange(true),
    onSwipedDown: () => onExpandedChange(false),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
  })

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div
        className={cn(
          "transition-all duration-300 ease-in-out bg-secondary/20 backdrop-blur-md border-t border-white/5 shadow-lg",
          isExpanded ? "h-[60vh]" : "h-auto",
        )}
      >
        {/* Handle for swiping */}
        <div
          {...swipeHandlers}
          className="h-6 w-full flex items-center justify-center cursor-pointer"
          onClick={() => onExpandedChange(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronDown className="w-6 h-6 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* Error/success messages */}
        <AnimatePresence>
          {(error || successMessage) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 py-2 text-center"
            >
              {error && <p className="text-sm text-destructive font-medium">{error}</p>}
              {successMessage && <p className="text-sm text-green-500 font-medium">{successMessage}</p>}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded keyboard */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="p-3 space-y-4"
            >
              {/* Score display */}
              <div className="flex items-center justify-between mb-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>

                <div className="flex-1 flex items-center justify-center">
                  {selectedNumber ? (
                    <motion.div
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      className="text-3xl font-bold tabular-nums bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100"
                    >
                      {selectedNumber * multiplier}
                    </motion.div>
                  ) : (
                    <Target className="w-8 h-8 text-muted-foreground opacity-50" />
                  )}
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={selectedNumber === null}
                  size="sm"
                  className={selectedNumber !== null ? "" : "opacity-50"}
                >
                  <Check className="w-5 h-5" />
                </Button>
              </div>

              {/* Multiplier buttons */}
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

              {/* Number grid */}
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

              {/* Bull buttons */}
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

              {/* Clear button */}
              <Button
                variant="outline"
                onClick={clearSelection}
                className="w-full bg-secondary/30 border-white/10 hover:bg-secondary/50"
              >
                <X className="w-4 h-4 mr-2" />
                Clear
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

