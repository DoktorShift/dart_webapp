"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Palette, Check, Moon, Sun, Monitor, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface ThemeOption {
  name: string
  primary: string
  secondary: string
  accent: string
  background: string
}

const PRESET_THEMES: ThemeOption[] = [
  {
    name: "Blue",
    primary: "#3b82f6",
    secondary: "#1e293b",
    accent: "#60a5fa",
    background: "#0f172a",
  },
  {
    name: "Purple",
    primary: "#8b5cf6",
    secondary: "#1e1b4b",
    accent: "#a78bfa",
    background: "#0f172a",
  },
  {
    name: "Green",
    primary: "#10b981",
    secondary: "#064e3b",
    accent: "#34d399",
    background: "#0f172a",
  },
  {
    name: "Red",
    primary: "#ef4444",
    secondary: "#450a0a",
    accent: "#f87171",
    background: "#0f172a",
  },
  {
    name: "Orange",
    primary: "#f97316",
    secondary: "#431407",
    accent: "#fb923c",
    background: "#0f172a",
  },
  {
    name: "Pink",
    primary: "#ec4899",
    secondary: "#500724",
    accent: "#f472b6",
    background: "#0f172a",
  },
]

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const [selectedPreset, setSelectedPreset] = useState<string>("Blue")
  const [isVisible, setIsVisible] = useState(true)
  const [customTheme, setCustomTheme] = useState<ThemeOption>({
    name: "Custom",
    primary: "#3b82f6",
    secondary: "#1e293b",
    accent: "#60a5fa",
    background: "#0f172a",
  })

  const applyTheme = (themeOption: ThemeOption) => {
    // This would normally update CSS variables
    document.documentElement.style.setProperty("--primary-color", themeOption.primary)
    document.documentElement.style.setProperty("--secondary-color", themeOption.secondary)
    document.documentElement.style.setProperty("--accent-color", themeOption.accent)
    document.documentElement.style.setProperty("--background-color", themeOption.background)

    setSelectedPreset(themeOption.name)

    // Save theme preference
    localStorage.setItem("dartTheme", JSON.stringify(themeOption))
  }

  const handleColorChange = (property: keyof ThemeOption, value: string) => {
    setCustomTheme((prev) => ({
      ...prev,
      [property]: value,
    }))
  }

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
            <Card className="card relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10"
                onClick={() => setIsVisible(false)}
              >
                <X className="w-4 h-4" />
              </Button>
              <CardContent className="p-4 pt-6">
                <Tabs defaultValue="presets">
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="presets">Presets</TabsTrigger>
                    <TabsTrigger value="custom">Custom</TabsTrigger>
                  </TabsList>

                  <TabsContent value="presets" className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      {PRESET_THEMES.map((themeOption) => (
                        <Button
                          key={themeOption.name}
                          variant="outline"
                          className="h-auto p-3 flex flex-col items-center justify-center bg-secondary/30 border-white/10"
                          onClick={() => applyTheme(themeOption)}
                        >
                          <div className="flex space-x-1 mb-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: themeOption.primary }}
                            ></div>
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: themeOption.secondary }}
                            ></div>
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: themeOption.accent }}></div>
                          </div>
                          <span className="text-sm">{themeOption.name}</span>
                          {selectedPreset === themeOption.name && (
                            <Check className="w-3 h-3 absolute top-1 right-1 text-primary" />
                          )}
                        </Button>
                      ))}
                    </div>

                    <div className="border-t border-white/10 pt-4">
                      <h3 className="text-sm font-medium mb-2">Mode</h3>
                      <div className="flex space-x-2">
                        <Button
                          variant={theme === "light" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setTheme("light")}
                          className="flex-1"
                        >
                          <Sun className="w-4 h-4 mr-2" />
                          Light
                        </Button>
                        <Button
                          variant={theme === "dark" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setTheme("dark")}
                          className="flex-1"
                        >
                          <Moon className="w-4 h-4 mr-2" />
                          Dark
                        </Button>
                        <Button
                          variant={theme === "system" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setTheme("system")}
                          className="flex-1"
                        >
                          <Monitor className="w-4 h-4 mr-2" />
                          System
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="custom" className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium block mb-1">Primary Color</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="color"
                            value={customTheme.primary}
                            onChange={(e) => handleColorChange("primary", e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={customTheme.primary}
                            onChange={(e) => handleColorChange("primary", e.target.value)}
                            className="flex-1 bg-secondary/30 border border-white/10 rounded p-1 text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium block mb-1">Secondary Color</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="color"
                            value={customTheme.secondary}
                            onChange={(e) => handleColorChange("secondary", e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={customTheme.secondary}
                            onChange={(e) => handleColorChange("secondary", e.target.value)}
                            className="flex-1 bg-secondary/30 border border-white/10 rounded p-1 text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium block mb-1">Accent Color</label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="color"
                            value={customTheme.accent}
                            onChange={(e) => handleColorChange("accent", e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={customTheme.accent}
                            onChange={(e) => handleColorChange("accent", e.target.value)}
                            className="flex-1 bg-secondary/30 border border-white/10 rounded p-1 text-sm"
                          />
                        </div>
                      </div>
                    </div>

                    <Button onClick={() => applyTheme(customTheme)} className="w-full">
                      <Palette className="w-4 h-4 mr-2" />
                      Apply Custom Theme
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

