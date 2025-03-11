"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { Info, X, ThumbsUp, Bookmark, Share2, ChevronLeft, ChevronRight } from "lucide-react"

interface DartFact {
  id: number
  title: string
  content: string
  image?: string
  likes: number
  saved: boolean
}

const DART_FACTS: DartFact[] = [
  {
    id: 1,
    title: "The Origin of Darts",
    content:
      "The game of darts originated in England during the Middle Ages. Soldiers would throw short arrows at the bottom of an empty wine barrel or at the cross-section of a tree, where the natural rings and cracks would create segments.",
    image: "/assets/images/dart-history.jpg",
    likes: 124,
    saved: false,
  },
  {
    id: 2,
    title: "Perfect Score",
    content:
      "The highest possible score with three darts is 180, achieved by throwing three triple 20s. The first televised 9-dart finish (perfect leg) was achieved by John Lowe in 1984.",
    image: "/assets/images/perfect-score.jpg",
    likes: 89,
    saved: false,
  },
  {
    id: 3,
    title: "Dartboard Segments",
    content:
      "The numbering on a standard dartboard is designed to penalize inaccuracy. The numbers are arranged so that high value segments are surrounded by low value segments.",
    image: "/assets/images/dartboard.jpg",
    likes: 67,
    saved: false,
  },
  {
    id: 4,
    title: "Dart Weight",
    content:
      "Professional darts typically weigh between 18-30 grams. The weight you choose depends on your throwing style. Heavier darts fly straighter but require more force.",
    likes: 52,
    saved: false,
  },
  {
    id: 5,
    title: "Checkout Strategies",
    content:
      "Professional players plan their checkout routes carefully. The most efficient checkout for scores above 40 is usually to aim for a treble first to leave a finish ending in a double.",
    image: "/assets/images/checkout.jpg",
    likes: 78,
    saved: false,
  },
]

export function DartFacts() {
  const [facts, setFacts] = useState<DartFact[]>(DART_FACTS)
  const [currentFactIndex, setCurrentFactIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  const toggleLike = (id: number) => {
    setFacts(
      facts.map((fact) =>
        fact.id === id ? { ...fact, likes: fact.saved ? fact.likes - 1 : fact.likes + 1, saved: !fact.saved } : fact,
      ),
    )
  }

  const toggleSave = (id: number) => {
    setFacts(facts.map((fact) => (fact.id === id ? { ...fact, saved: !fact.saved } : fact)))
  }

  const shareFact = (fact: DartFact) => {
    if (navigator.share) {
      navigator
        .share({
          title: fact.title,
          text: fact.content,
          url: window.location.href,
        })
        .catch((err) => console.error("Error sharing:", err))
    }
  }

  const nextFact = () => {
    setCurrentFactIndex((prev) => (prev + 1) % facts.length)
  }

  const prevFact = () => {
    setCurrentFactIndex((prev) => (prev - 1 + facts.length) % facts.length)
  }

  const currentFact = facts[currentFactIndex]

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center p-4 z-50 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-md"
          >
            <Card className="card overflow-hidden relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10 bg-black/50 text-white rounded-full p-1"
                onClick={() => setIsVisible(false)}
              >
                <X className="w-4 h-4" />
              </Button>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentFactIndex}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.3 }}
                >
                  {currentFact.image && (
                    <div className="h-40 overflow-hidden">
                      <img
                        src={currentFact.image || "/placeholder.svg?height=160&width=400"}
                        alt={currentFact.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="w-4 h-4 text-primary" />
                      <h3 className="text-lg font-semibold">{currentFact.title}</h3>
                    </div>

                    <p className="text-sm text-muted-foreground mb-4">{currentFact.content}</p>

                    <div className="flex justify-between items-center">
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => toggleLike(currentFact.id)}
                        >
                          <ThumbsUp className={`w-4 h-4 mr-1 ${currentFact.saved ? "text-primary" : ""}`} />
                          {currentFact.likes}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => toggleSave(currentFact.id)}
                        >
                          <Bookmark className={`w-4 h-4 ${currentFact.saved ? "text-primary fill-primary" : ""}`} />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => shareFact(currentFact)}
                        >
                          <Share2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="flex space-x-1">
                        <Button variant="ghost" size="sm" onClick={prevFact} className="h-8 w-8 p-0 rounded-full">
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={nextFact} className="h-8 w-8 p-0 rounded-full">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </motion.div>
              </AnimatePresence>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

