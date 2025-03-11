"use client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Check, X } from "lucide-react"

interface CricketBoardProps {
  onScore: (number: number, marks: number) => void
  scores: { [key: string]: { marks: number; closed: boolean } }
  isCutThroat?: boolean
}

export function CricketBoard({ onScore, scores, isCutThroat }: CricketBoardProps) {
  const numbers = ["20", "19", "18", "17", "16", "15", "Bull"]

  return (
    <div className="grid gap-3">
      {numbers.map((number) => (
        <Card key={number} className="p-4 card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold w-16 bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100">
                {number}
              </span>
              <div className="flex gap-2">
                {[1, 2, 3].map((mark) => (
                  <Button
                    key={mark}
                    variant="outline"
                    size="sm"
                    className={`w-8 h-8 ${
                      scores[number]?.marks >= mark
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/30 border-white/10"
                    }`}
                    onClick={() => onScore(Number.parseInt(number === "Bull" ? "25" : number), mark)}
                  >
                    {scores[number]?.closed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </Button>
                ))}
              </div>
            </div>
            {isCutThroat && scores[number]?.marks > 3 && (
              <span className="text-xl font-bold">{scores[number].marks - 3}</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}

