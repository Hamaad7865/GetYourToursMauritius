import type { Config } from 'tailwindcss';

/**
 * Brand tokens are defined once as CSS custom properties in `app/globals.css`
 * and mapped here so Tailwind utilities stay a thin layer over the design system.
 * Source of truth: design-reference/BelleMareTours-handoff.zip.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: 'rgb(var(--color-cream) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
        },
        coral: 'rgb(var(--color-coral) / <alpha-value>)',
        teal: {
          DEFAULT: 'rgb(var(--color-teal) / <alpha-value>)',
          dark: 'rgb(var(--color-teal-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-teal-tint) / <alpha-value>)',
          bright: 'rgb(var(--color-teal-bright) / <alpha-value>)',
        },
        gold: {
          DEFAULT: 'rgb(var(--color-gold) / <alpha-value>)',
          light: 'rgb(var(--color-gold-light) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
      },
      maxWidth: {
        shell: '1200px',
      },
    },
  },
  plugins: [],
};

export default config;
