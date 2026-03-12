const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        bg2: "var(--bg2)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
        border: "var(--border)",
        border2: "var(--border2)",
        violet: "var(--violet)",
        violet2: "var(--violet2)",
        cyan: "var(--cyan)",
        cyan2: "var(--cyan2)",
        green: "var(--green)",
        amber: "var(--amber)",
        red: "var(--red)",
        pink: "var(--pink)",
        text: "var(--text)",
        text2: "var(--text2)",
        text3: "var(--text3)"
      },
      fontFamily: {
        head: ["var(--font-head)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"]
      },
      boxShadow: {
        glass: "0 18px 60px rgba(0, 0, 0, 0.35)",
        violet: "var(--glow-v)",
        cyan: "var(--glow-c)"
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)"
      },
      animation: {
        shimmer: "shimmer 1.5s linear infinite",
        float: "float 6s ease-in-out infinite",
        pulseSoft: "pulseSoft 2s ease-in-out infinite",
        slideInRight: "slideInRight 0.3s ease forwards",
        fadeUp: "fadeUp 0.35s ease forwards"
      }
    }
  },
  plugins: []
};

export default config;
