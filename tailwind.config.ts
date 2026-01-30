import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        bombonera: {
          50: "#f0faf0",
          100: "#d4f0d4",
          200: "#a8e0a8",
          300: "#6bc96b",
          400: "#3da63d",
          500: "#1a7a1a",
          600: "#156215",
          700: "#104b10",
          800: "#0c390c",
          900: "#082608",
          950: "#041304",
        },
        field: {
          green: "#2d6a2d",
          dark: "#1a4a1a",
          line: "#ffffff",
        },
        status: {
          available: "#22c55e",
          reserved: "#f59e0b",
          blocked: "#ef4444",
          paid: "#3b82f6",
        },
      },
      fontSize: {
        "body": ["18px", "28px"],
        "body-lg": ["20px", "30px"],
        "heading": ["28px", "36px"],
        "heading-lg": ["36px", "44px"],
        "display": ["48px", "56px"],
      },
    },
  },
  plugins: [],
};
export default config;
