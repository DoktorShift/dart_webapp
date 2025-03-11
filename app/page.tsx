"use client"

import { useState, useEffect } from "react"
import { WelcomeScreen } from "@/components/welcome-screen"
import { PlayerSetup } from "@/components/player-setup"
import { SettingsDialog } from "@/components/settings-dialog"
import { WinningScreen } from "@/components/winning-screen"
import { GameHeader } from "@/components/game-header"
import { PlayerCard } from "@/components/player-card"
import { ScoreInput } from "@/components/score-input"
import { MobileScoreInput } from "@/components/mobile-score-input"
import { MobilePlayerCards } from "@/components/mobile-player-cards"
import { MobileNavigation } from "@/components/mobile-navigation"
import { ThemeSelector } from "@/components/theme-selector"
import { DartFacts } from "@/components/dart-facts"
import { CheckoutSuggestions } from "@/components/checkout-suggestions"
import { CricketBoard } from "@/components/game-modes/cricket-board"
import { ClockBoard } from "@/components/game-modes/clock-board"
import { motion, AnimatePresence } from "framer-motion"
import { useMobile } from "@/hooks/use-mobile"
import { GAME_MODES, type GameMode, type CricketScore, type ClockScore } from "@/types/game-modes"
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"

type GameState = "welcome" | "setup" | "playing" | "finished"

interface Player {
  id: number
  name: string
  score: number
  rounds: number[]
  cricketScore?: CricketScore
  clockScore?: ClockScore
}

export default function DartScorer() {
  const [gameState, setGameState] = useState<GameState>("welcome")
  const [gameMode, setGameMode] = useState<GameMode>(GAME_MODES[1]) // Default to 501
  const [players, setPlayers] = useState<Player[]>([])
  const [currentPlayer, setCurrentPlayer] = useState(0)
  const [gameHistory, setGameHistory] = useState<number[][]>([])
  const [winner, setWinner] = useState<Player | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("game")
  const [settings, setSettings] = useState({
    soundEnabled: true,
    animations: true,
    doubleOut: true,
  })
  const [keyboardExpanded, setKeyboardExpanded] = useState(true)

  const isMobile = useMobile()

  // Sound effects
  const playSound = (type: "score" | "bust" | "win" | "click") => {
    if (!settings.soundEnabled) return

    const sounds = {
      score: "/score.mp3",
      bust: "/bust.mp3",
      win: "/win.mp3",
      click: "/click.mp3",
    }

    new Audio(sounds[type]).play().catch(() => {})
  }

  const handleGameSelect = (modeId: string) => {
    const selectedMode = GAME_MODES.find((mode) => mode.id === modeId)!
    setGameMode(selectedMode)
    setGameState("setup")
    playSound("click")
  }

  const handlePlayerSetup = (players: Array<{ id: number; name: string }>) => {
    setPlayers(
      players.map((p) => ({
        ...p,
        score: gameMode.startScore || 0,
        rounds: [],
        cricketScore:
          gameMode.type === "cricket"
            ? {
                "15": 0,
                "16": 0,
                "17": 0,
                "18": 0,
                "19": 0,
                "20": 0,
                "25": 0,
                marks: {},
              }
            : undefined,
        clockScore:
          gameMode.type === "clock"
            ? {
                currentNumber: 1,
                completed: [],
              }
            : undefined,
      })),
    )
    setGameState("playing")
    playSound("click")
  }

  const handleScoreSubmit = (score: number) => {
    if (gameState !== "playing") return

    setPlayers((prev) => {
      const newPlayers = [...prev]
      const player = newPlayers[currentPlayer]

      if (gameMode.type === "x01") {
        const newScore = player.score - score

        // Handle bust conditions
        if (newScore < 0 || newScore === 1 || (newScore === 0 && settings.doubleOut && score % 2 !== 0)) {
          playSound("bust")
          player.rounds.push(0) // Add a zero score for the bust

          // Check if player has completed 3 throws
          if (player.rounds.length % 3 === 0) {
            setCurrentPlayer((prev) => (prev + 1) % players.length)
            // Auto-open keyboard for next player
            setKeyboardExpanded(true)
          }

          return newPlayers
        }

        // Handle winning condition
        if (newScore === 0) {
          player.score = newScore
          player.rounds.push(score)
          setWinner(player)
          setGameState("finished")
          playSound("win")
          return newPlayers
        }

        player.score = newScore
        player.rounds.push(score)
        playSound("score")

        // Check if player has completed 3 throws
        if (player.rounds.length % 3 === 0) {
          setCurrentPlayer((prev) => (prev + 1) % players.length)
          // Auto-open keyboard for next player
          setKeyboardExpanded(true)
        }
      }

      return newPlayers
    })

    if (gameMode.type === "x01") {
      setGameHistory((prev) => [...prev, players.map((p) => p.score)])
    }
  }

  const handleCricketScore = (number: number, marks: number) => {
    setPlayers((prev) => {
      const newPlayers = [...prev]
      const player = newPlayers[currentPlayer]

      if (!player.cricketScore) return prev

      const currentMarks = player.cricketScore.marks[number] || 0
      const newMarks = currentMarks + marks

      player.cricketScore.marks[number] = newMarks
      player.cricketScore[number] = Math.min(newMarks, 3)

      // Check for winner in Cricket modes
      const allClosed = Object.entries(player.cricketScore)
        .filter(([key]) => key !== "marks")
        .every(([_, marks]) => marks >= 3)

      if (allClosed) {
        setWinner(player)
        setGameState("finished")
        playSound("win")
      } else {
        playSound("score")
      }

      return newPlayers
    })

    setCurrentPlayer((prev) => (prev + 1) % players.length)
  }

  const handleClockHit = () => {
    setPlayers((prev) => {
      const newPlayers = [...prev]
      const player = newPlayers[currentPlayer]

      if (!player.clockScore) return prev

      const { currentNumber } = player.clockScore
      player.clockScore.completed.push(currentNumber)
      player.clockScore.currentNumber = currentNumber + 1

      if (currentNumber === 20) {
        setWinner(player)
        setGameState("finished")
        playSound("win")
      } else {
        playSound("score")
      }

      return newPlayers
    })

    setCurrentPlayer((prev) => (prev + 1) % players.length)
  }

  const handleUndo = () => {
    if (gameHistory.length === 0) return

    const lastScores = gameHistory[gameHistory.length - 1]
    setPlayers((prev) =>
      prev.map((player, i) => ({
        ...player,
        score: lastScores[i],
        rounds: player.rounds.slice(0, -1),
      })),
    )
    setGameHistory((prev) => prev.slice(0, -1))
    setCurrentPlayer((prev) => (prev - 1 + players.length) % players.length)
    playSound("click")
  }

  const handlePlayAgain = () => {
    setPlayers((prev) =>
      prev.map((player) => ({
        ...player,
        score: gameMode.startScore || 0,
        rounds: [],
        cricketScore:
          gameMode.type === "cricket"
            ? {
                "15": 0,
                "16": 0,
                "17": 0,
                "18": 0,
                "19": 0,
                "20": 0,
                "25": 0,
                marks: {},
              }
            : undefined,
        clockScore:
          gameMode.type === "clock"
            ? {
                currentNumber: 1,
                completed: [],
              }
            : undefined,
      })),
    )
    setCurrentPlayer(0)
    setWinner(null)
    setGameHistory([])
    setGameState("playing")
    playSound("click")
  }

  const handleNewGame = () => {
    setGameState("welcome")
    setPlayers([])
    setCurrentPlayer(0)
    setWinner(null)
    setGameHistory([])
    playSound("click")
  }

  const handleStopGame = () => {
    playSound("click")
    handleNewGame()
  }

  const handlePlayerNameChange = (id: number, name: string) => {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  const handlePlayerChange = (index: number) => {
    setCurrentPlayer(index)
    setKeyboardExpanded(true)
  }

  const handleShareResult = (player: Player) => {
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

  // Preload sounds
  useEffect(() => {
    if (settings.soundEnabled) {
      const sounds = ["score", "bust", "win", "click"]
      sounds.forEach((sound) => {
        const audio = new Audio(`/${sound}.mp3`)
        audio.preload = "auto"
      })
    }
  }, [settings.soundEnabled])

  // Render mobile game content based on active tab
  const renderMobileGameContent = () => {
    switch (activeTab) {
      case "game":
        return (
          <>
            {gameMode.type === "cricket" && (
              <CricketBoard
                onScore={handleCricketScore}
                scores={players[currentPlayer]?.cricketScore?.marks || {}}
                isCutThroat={gameMode.id === "cutthroat"}
              />
            )}

            {gameMode.type === "clock" && players[currentPlayer]?.clockScore && (
              <ClockBoard
                currentNumber={players[currentPlayer].clockScore.currentNumber}
                completed={players[currentPlayer].clockScore.completed}
                onHit={handleClockHit}
              />
            )}
          </>
        )
      case "players":
        return (
          <div className="grid gap-4">
            {players.map((player, index) => (
              <PlayerCard
                key={player.id}
                player={player}
                isActive={currentPlayer === index}
                onNameChange={(name) => handlePlayerNameChange(player.id, name)}
                onRemove={() => {}}
                isWinner={false}
              />
            ))}
          </div>
        )
      case "facts":
        return <DartFacts />
      case "themes":
        return <ThemeSelector />
      case "settings":
        return (
          <div className="space-y-4">
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              className="w-full bg-secondary/30 border-white/10"
            >
              <Settings className="w-4 h-4 mr-2" />
              Open Settings
            </Button>
            <Button variant="outline" onClick={handlePlayAgain} className="w-full bg-secondary/30 border-white/10">
              Restart Game
            </Button>
            <Button
              variant="outline"
              onClick={handleStopGame}
              className="w-full bg-secondary/30 border-white/10 text-destructive"
            >
              End Game
            </Button>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-background">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(29,78,216,0.15),transparent_50%)]" />
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(29,78,216,0.15),transparent_50%)]" />

      <div className="relative z-10">
        <AnimatePresence mode="wait">
          {gameState === "welcome" && (
            <WelcomeScreen onGameSelect={handleGameSelect} onSettingsOpen={() => setSettingsOpen(true)} />
          )}

          {gameState === "setup" && (
            <PlayerSetup onComplete={handlePlayerSetup} onBack={() => setGameState("welcome")} />
          )}

          {gameState === "playing" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto p-4 space-y-6 pb-32 md:pb-16"
            >
              <GameHeader
                gameMode={gameMode.id}
                onStop={handleStopGame}
                onSettingsOpen={() => setSettingsOpen(true)}
                playersCount={players.length}
              />

              {isMobile ? (
                <>
                  <MobilePlayerCards
                    players={players}
                    currentPlayerIndex={currentPlayer}
                    onNameChange={handlePlayerNameChange}
                    onPlayerChange={handlePlayerChange}
                    onShare={handleShareResult}
                  />

                  <div className="pb-36">{renderMobileGameContent()}</div>

                  <MobileNavigation activeTab={activeTab} onTabChange={setActiveTab} />

                  {gameMode.type === "x01" && (
                    <>
                      <div className="mb-24">
                        <CheckoutSuggestions score={players[currentPlayer].score} />
                      </div>
                      <MobileScoreInput
                        onScoreSubmit={handleScoreSubmit}
                        onUndo={handleUndo}
                        canUndo={gameHistory.length > 0}
                        currentScore={players[currentPlayer].score}
                        isExpanded={keyboardExpanded}
                        onExpandedChange={setKeyboardExpanded}
                        attemptsCount={players[currentPlayer].rounds.length % 3}
                      />
                      {/* Add a floating indicator for current player score when keyboard is collapsed */}
                      <div className="fixed bottom-16 right-4 z-20 bg-primary/90 text-primary-foreground rounded-full px-4 py-2 shadow-lg">
                        <span className="font-bold">{players[currentPlayer].score}</span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                    <AnimatePresence>
                      {players.map((player, index) => (
                        <motion.div
                          key={player.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ duration: 0.3 }}
                        >
                          <PlayerCard
                            player={player}
                            isActive={currentPlayer === index}
                            onNameChange={(name) => handlePlayerNameChange(player.id, name)}
                            onRemove={() => {}}
                            isWinner={false}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {gameMode.type === "cricket" && (
                    <CricketBoard
                      onScore={handleCricketScore}
                      scores={players[currentPlayer]?.cricketScore?.marks || {}}
                      isCutThroat={gameMode.id === "cutthroat"}
                    />
                  )}

                  {gameMode.type === "clock" && players[currentPlayer]?.clockScore && (
                    <ClockBoard
                      currentNumber={players[currentPlayer].clockScore.currentNumber}
                      completed={players[currentPlayer].clockScore.completed}
                      onHit={handleClockHit}
                    />
                  )}

                  {gameMode.type === "x01" && (
                    <>
                      <CheckoutSuggestions score={players[currentPlayer].score} />
                      <ScoreInput
                        onScoreSubmit={handleScoreSubmit}
                        onUndo={handleUndo}
                        canUndo={gameHistory.length > 0}
                        currentScore={players[currentPlayer].score}
                      />
                    </>
                  )}
                </>
              )}
            </motion.div>
          )}

          {gameState === "finished" && winner && (
            <WinningScreen winner={winner} onPlayAgain={handlePlayAgain} onNewGame={handleNewGame} />
          )}
        </AnimatePresence>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={setSettings}
        />
      </div>
    </div>
  )
}

