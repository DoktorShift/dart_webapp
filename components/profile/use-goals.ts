"use client"

import { readGoals, type TrainingGoals } from "@/lib/profile/goal"
import { useStored } from "@/lib/storage/hooks"

const NONE: TrainingGoals = {}

// The training goals kept on this device, following changes from any tab.
export function useTrainingGoals() {
  const [goals] = useStored("kv", readGoals)
  return goals ?? NONE
}
