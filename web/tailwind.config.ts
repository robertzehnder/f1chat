import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Phase 26 UI: dark "F1 Insights" theme.
        canvas: {
          DEFAULT: "#0A0A0A"
        },
        surface: {
          DEFAULT: "#111111",
          secondary: "#161616",
          hover: "#1C1C1C"
        },
        border: {
          DEFAULT: "#262626",
          subtle: "#1F1F1F"
        },
        accent: {
          DEFAULT: "#E10600",     // F1 official red
          soft: "#3A0A0A",
          hover: "#FF1A0F"
        },
        ink: {
          DEFAULT: "#FAFAFA",
          secondary: "#A3A3A3",
          tertiary: "#737373"
        },
        semantic: {
          success: "#22C55E",
          "success-soft": "#0F2A1B",
          warning: "#F59E0B",
          "warning-soft": "#2A1F0B",
          error: "#EF4444",
          "error-soft": "#2A0F0F"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.4)",
        card: "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px #262626",
        md: "0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px #262626"
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px"
      }
    }
  },
  plugins: []
};

export default config;
