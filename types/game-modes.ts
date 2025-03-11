export type GameMode = {
  id: string
  name: string
  description: string
  type: "x01" | "clock" | "cricket"
  startScore?: number
}

export const GAME_MODES: GameMode[] = [
  {
    id: "301",
    name: "301",
    description: "Quick Game",
    type: "x01",
    startScore: 301,
  },
  {
    id: "501",
    name: "501",
    description: "Standard Game",
    type: "x01",
    startScore: 501,
  },
  {
    id: "701",
    name: "701",
    description: "Extended Game",
    type: "x01",
    startScore: 701,
  },
  {
    id: "clock",
    name: "Around the Clock",
    description: "Hit 1-20 in order",
    type: "clock",
  },
  {
    id: "cricket",
    name: "Cricket",
    description: "Close numbers 15-20 & Bull",
    type: "cricket",
  },
  {
    id: "cutthroat",
    name: "Cut Throat Cricket",
    description: "Cricket with a twist",
    type: "cricket",
  },
]

export type CricketScore = {
  [key: string]: number // 15-20 and 25(bull)
  marks: { [key: string]: number }
}

export type ClockScore = {
  currentNumber: number
  completed: number[]
}

