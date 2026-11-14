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
          // Back office only (see globals.css): secondary text and the raised sidebar surface.
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          raised: 'rgb(var(--color-ink-raised) / <alpha-value>)',
        },
        coral: {
          DEFAULT: 'rgb(var(--color-coral) / <alpha-value>)',
          dark: 'rgb(var(--color-coral-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-coral-tint) / <alpha-value>)',
        },
        teal: {
          DEFAULT: 'rgb(var(--color-teal) / <alpha-value>)',
          dark: 'rgb(var(--color-teal-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-teal-tint) / <alpha-value>)',
          bright: 'rgb(var(--color-teal-bright) / <alpha-value>)',
        },
        gold: {
          DEFAULT: 'rgb(var(--color-gold) / <alpha-value>)',
          light: 'rgb(var(--color-gold-light) / <alpha-value>)',
          dark: 'rgb(var(--color-gold-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-gold-tint) / <alpha-value>)',
        },
        // The back office's neutrals and status tints (design-reference/backoffice-redesign/bo.css).
        // `blue` and `violet` extend Tailwind's own scales, which stay as they are.
        line: {
          DEFAULT: 'rgb(var(--color-line) / <alpha-value>)',
          soft: 'rgb(var(--color-line-soft) / <alpha-value>)',
        },
        ground: 'rgb(var(--color-ground) / <alpha-value>)',
        blue: {
          dark: 'rgb(var(--color-blue-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-blue-tint) / <alpha-value>)',
        },
        violet: {
          dark: 'rgb(var(--color-violet-dark) / <alpha-value>)',
          tint: 'rgb(var(--color-violet-tint) / <alpha-value>)',
        },
      },
      fontFamily: {
        // The brand serif (Fraunces) was retired on request — the app now uses ONE consistent sans
        // everywhere. `display` is deliberately kept as an alias of the body font so the ~90 existing
        // `font-display` usages (headings, prices, hero) need no per-file edit and simply render in
        // Plus Jakarta Sans. Reintroducing a display face is a one-line change here.
        display: ['var(--font-body)', 'system-ui', '-apple-system', 'sans-serif'],
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
