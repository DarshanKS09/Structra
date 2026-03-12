import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "rgba(255, 255, 255, 0.08)",
        border: "rgba(255, 255, 255, 0.22)",
        darksurface: "rgba(17, 24, 39, 0.7)"
      },
      boxShadow: {
        glass: "0 10px 30px rgba(0, 0, 0, 0.2)"
      }
    }
  },
  plugins: []
};

export default config;
