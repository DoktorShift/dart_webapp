"use client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Check } from "lucide-react"

interface ClockBoardProps {
  currentNumber: number
  completed: number[]
  onHit: () => void
}

export function ClockBoard({ currentNumber, completed, onHit }: ClockBoardProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {Array.from({ length: 20 }, (_, i) => i + 1).map((number) => (
        <Card key={number} className={`p-3 card ${currentNumber === number ? "ring-1 ring-primary" : ""}`}>
          <Button
            variant="ghost"
            className={`w-full h-full text-2xl font-bold ${
              completed.includes(number)
                ? "text-muted-foreground"
                : currentNumber === number
                  ? "text-primary bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600"
                  : ""
            }`}
            onClick={currentNumber === number ? onHit : undefined}
            disabled={currentNumber !== number}
          >
            {completed.includes(number) ? <Check className="w-6 h-6" /> : number}
          </Button>
        </Card>
      ))}
    </div>
  )
}

