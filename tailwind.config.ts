import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        abody: {
          teal: "#0d9488",
          "teal-dark": "#0f766e"
        }
      }
    }
  },
  plugins: []
};

export default config;

