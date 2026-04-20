import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "pg-slate": "var(--pg-slate)",
        "pg-ink": "var(--pg-ink)",
        "pg-sand": "var(--pg-sand)",
        "pg-cyan": "var(--pg-cyan)",
        "pg-coral": "var(--pg-coral)"
      },
      boxShadow: {
        panel: "0 10px 28px rgba(20, 32, 46, 0.12)"
      },
      keyframes: {
        floaty: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" }
        },
        rise: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        rise: "rise 500ms ease-out"
      }
    }
  },
  plugins: []
};

export default config;
