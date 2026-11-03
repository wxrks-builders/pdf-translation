/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // The wxrks platform design system (src/wx/tokens.css): graphite actions, green only
      // where it means something.
      fontFamily: {
        sans: ['"Visual Sans"', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f3f5f7",
          100: "#e7ebef",
          200: "#dfe3e8",
          500: "#57616d",
          600: "#252a31",
          700: "#181b1f",
          900: "#111418",
        },
        accent: "#00742c",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,22,40,0.04), 0 1px 1px rgba(20,22,40,0.03)",
      },
    },
  },
  plugins: [],
};
