"use client"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Target, Users, Settings, Info, Palette } from "lucide-react"
import { cn } from "@/lib/utils"

interface MobileNavigationProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function MobileNavigation({ activeTab, onTabChange }: MobileNavigationProps) {
  const tabs = [
    { id: "game", icon: <Target className="w-5 h-5" />, label: "Game" },
    { id: "players", icon: <Users className="w-5 h-5" />, label: "Players" },
    { id: "facts", icon: <Info className="w-5 h-5" />, label: "Facts" },
    { id: "themes", icon: <Palette className="w-5 h-5" />, label: "Themes" },
    { id: "settings", icon: <Settings className="w-5 h-5" />, label: "Settings" },
  ]

  return (
    <div
      className="fixed bottom-[70px] left-0 right-0 z-20 px-2 pb-2"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="bg-secondary/40 backdrop-blur-md border border-white/10 rounded-xl p-1 flex justify-between max-w-md mx-auto shadow-lg">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            size="sm"
            className={cn(
              "flex flex-col items-center justify-center py-2 px-1 rounded-lg relative",
              activeTab === tab.id ? "text-primary" : "text-muted-foreground",
            )}
            onClick={() => onTabChange(tab.id)}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-secondary/50 rounded-lg border border-primary/20"
                initial={false}
                transition={{ type: "spring", duration: 0.5 }}
              />
            )}
            <span className="relative z-10">{tab.icon}</span>
            <span className="text-[10px] relative z-10 mt-1">{tab.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

