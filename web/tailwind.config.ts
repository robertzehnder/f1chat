import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#F6F5F2"
        },
        surface: {
          DEFAULT: "#FFFFFF",
          secondary: "#FAF9F6",
          hover: "#F0EFEC"
        },
        border: {
          DEFAULT: "#E6E3DB",
          subtle: "#EDEBE6"
        },
        accent: {
          DEFAULT: "#4F7FFF",
          soft: "#EAF1FF",
          hover: "#3D6CE8"
        },
        ink: {
          DEFAULT: "#171717",
          secondary: "#706E67",
          tertiary: "#9C9A93"
        },
        semantic: {
          success: "#2F8F6B",
          "success-soft": "#EEFBF4",
          warning: "#B7791F",
          "warning-soft": "#FEF9EE",
          error: "#DC4A3D",
          "error-soft": "#FEF1F0"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.04)",
        card: "0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px #EDEBE6",
        md: "0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px #E6E3DB"
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
