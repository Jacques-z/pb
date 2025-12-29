/** @type {import('tailwindcss').Config} */
import daisyui from "daisyui";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts,js,tsx}", "./src/**/*.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Avenir Next",
          "PingFang SC",
          "Noto Sans CJK SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: ["corporate"],
  },
};
