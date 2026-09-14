/**
 * Tailwind v4 PostCSS integration. The v4 plugin replaces the v3
 * tailwindcss postcss plugin + autoprefixer with a single plugin
 * that handles both.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
