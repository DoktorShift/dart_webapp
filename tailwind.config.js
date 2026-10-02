/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        // Side-by-side game layout: any landscape screen wide enough (phones and tablets).
        split: { raw: "(orientation: landscape) and (min-width: 560px)" },
        // Tablet-sized in both directions: bigger type and keys.
        tablet: { raw: "(min-width: 700px) and (min-height: 700px)" },
        // Small phones in portrait (iPhone SE) and every phone in landscape: tighter spacing.
        short: { raw: "(max-height: 740px)" },
        // Phones in landscape.
        xshort: { raw: "(max-height: 500px)" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        key: {
          DEFAULT: "hsl(var(--key))",
          quiet: "hsl(var(--key-quiet))",
          pressed: "hsl(var(--key-pressed))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "glow-sm": "0 2px 8px -2px rgba(29, 78, 216, 0.25)",
        "glow-md": "0 4px 12px -4px rgba(29, 78, 216, 0.3)",
        "glow-lg": "0 8px 24px -6px rgba(29, 78, 216, 0.35)",
        "glow-xl": "0 12px 36px -8px rgba(29, 78, 216, 0.4)",
        "inner-glow": "inset 0 2px 8px -2px rgba(29, 78, 216, 0.25)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

