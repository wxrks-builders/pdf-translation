/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#3b5bfd",
          600: "#2f47db",
          700: "#2739b0",
          900: "#0d1117",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,22,40,0.04), 0 1px 1px rgba(20,22,40,0.03)",
      },
    },
  },
  plugins: [],
};
