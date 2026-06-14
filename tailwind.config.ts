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
        cream: 'var(--color-cream)',
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
        },
        coral: 'var(--color-coral)',
        teal: {
          DEFAULT: 'var(--color-teal)',
          dark: 'var(--color-teal-dark)',
          tint: 'var(--color-teal-tint)',
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
