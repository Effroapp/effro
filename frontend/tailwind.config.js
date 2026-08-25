/** @type {import('tailwindcss').Config} */
export default {
  // Toggle dark mode by adding/removing the 'dark' class on <html>
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Light surfaces ──────────────────────────────────────────────────
        paper: {
          DEFAULT: '#F7F4ED',
          50:  '#FBFAF6',
          100: '#F7F4ED',  // page bg
          200: '#EFECE3',  // card
          300: '#E5E1D6',  // sub-card / hover
          400: '#D4CFC2',  // stone - borders
          500: '#A8A49E',  // soft text on dark
          600: '#8A877F',  // ink-muted
          700: '#4A4845',  // ink-soft
          800: '#1F1D1A',
          900: '#14130F',  // ink
        },
        // ── Dark surfaces ───────────────────────────────────────────────────
        pitch: {
          DEFAULT: '#0F0E0C',
          50:  '#EDEAE3',  // paper-d (text on dark)
          100: '#A8A49E',  // paper-soft-d
          200: '#6B6862',  // paper-muted-d
          300: '#4A4845',
          400: '#38352F',  // border on dark
          500: '#2A2826',
          600: '#232220',  // pitch-3
          700: '#181714',  // pitch-2
          800: '#0F0E0C',  // pitch (base)
          900: '#080706',
          950: '#050402',
        },
        // ── Brand colour (defined below in status section) ──────────────────
        // The `accent` namespace has been retired in favour of `mint`. See
        // the mint extension below.
        // ── Status colours (muted) ──────────────────────────────────────────
        sage:        '#7A9579',  // stable, resolved
        'sky-muted': '#6B8AB8',  // active, open
        'amber-muted': '#C99A5C', // on-hold
        mustard:     '#C9A85C',  // in-progress
        terracotta:  '#B86A5C',  // blocked
        lavender:    '#8A7BB8',  // parked
        // ── Custom entry type palette ───────────────────────────────────────
        // A second muted family, for user-defined entry types only. It exists
        // because the status colours above are all spoken for by the built-in
        // types (mint Update, sky-muted To Do, amber-muted Decision, lavender
        // Meeting, terracotta Blocked), so offering those again would make a
        // user's own type read as a Decision or a Blocker at a glance.
        // Names avoid Tailwind's own teal/rose/slate/stone scales.
        seafoam:     '#5A9490',  // custom type - teal
        dusk:        '#7B8794',  // custom type - blue grey
        plum:        '#7E5A78',  // custom type - plum
        heather:     '#C08497',  // custom type - dusty rose
        pebble:      '#8A8079',  // custom type - warm grey
        // (Source-badge text colours used to live here; the Signals badges now
        // carry identity through the ProviderLogo brand marks instead.)
        // ── Brand signature · mint ─────────────────────────────────────────
        // Used sparingly: the dot in "Effro.", the splash animation, and
        // "selected/active" state indicators. Never as a hover or focus colour.
        // ── Brand colour · clay ────────────────────────────────────────────
        // The person, not the product: avatars, the greeting by name, the
        // Areas grouping. Never on a control, never in a status context.
        // See the long note in tokens.css for why, and pick the step by the
        // job rather than by eye. The `fill` / `text` / `glyph` aliases read
        // from CSS vars so light and dark resolve themselves.
        clay: {
          DEFAULT: '#C1663F',
          50:  '#FDF4EF',
          100: '#FAE6DA',
          200: '#F3D0BB',
          300: '#E9B190',
          400: '#DA8A6A',  // every clay job on pitch
          500: '#C1663F',  // fills on paper, never wording
          600: '#A64F2A',  // wording on paper
          700: '#883E1E',  // initials on a clay tint
          800: '#6B2F14',
          900: '#52230D',
          fill:  'var(--clay-fill)',
          text:  'var(--clay-text)',
          glyph: 'var(--clay-glyph)',
        },
        mint: {
          DEFAULT: '#10B981',
          50:  '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
      },
      fontFamily: {
        // Geist: brand voice and product UI
        sans: ['Geist Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // Lexend: ADHD-friendly opt-in body alternative
        lexend: ['Lexend', 'Geist Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Geist Mono: timestamps, IDs, code, technical labels
        mono: ['Geist Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        // Keep "display" for backwards compatibility - now points to Geist
        display: ['Geist Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Smallest step - 11px, rem-based so the text-size control (useTextSize)
        // scales it like everything else. 11px is the floor: use sparingly, and
        // never below it (WCAG 1.4.4 Resize Text / plain readability). Larger
        // steps use Tailwind's built-in rem scale (xs 12px, sm 14px, base 16px).
        '2xs': ['0.6875rem', '1rem'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter: '-0.035em',
        snug: '-0.02em',
        soft: '-0.005em',
      },
      spacing: {
        // Named spacing tokens (in addition to Tailwind defaults)
        '1px': '1px',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '24px',
      },
      transitionTimingFunction: {
        effro: 'cubic-bezier(0.65, 0, 0.35, 1)',
        'effro-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      transitionDuration: {
        snap: '120ms',
        base: '200ms',
        slow: '400ms',
      },
      animation: {
        // legacy support
        'fade-in': 'fadeIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-in': 'slideIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        // new
        'rise': 'rise 400ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'draw-stem': 'drawStem 3s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'draw-top':  'drawTop  3s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'draw-bot':  'drawBot  3s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'spin-stem': 'drawStem 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'spin-top':  'drawTop  1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'spin-bot':  'drawBot  1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // ─── The Draw loading animation ──────────────────────────────────
        drawStem: {
          '0%':   { strokeDashoffset: '30' },
          '20%':  { strokeDashoffset: '0' },
          '65%':  { strokeDashoffset: '0' },
          '85%':  { strokeDashoffset: '-30' },
          '100%': { strokeDashoffset: '-30' },
        },
        drawTop: {
          '0%':   { strokeDashoffset: '38' },
          '20%':  { strokeDashoffset: '38' },
          '40%':  { strokeDashoffset: '0' },
          '65%':  { strokeDashoffset: '0' },
          '80%':  { strokeDashoffset: '-38' },
          '100%': { strokeDashoffset: '-38' },
        },
        drawBot: {
          '0%':   { strokeDashoffset: '38' },
          '35%':  { strokeDashoffset: '38' },
          '55%':  { strokeDashoffset: '0' },
          '65%':  { strokeDashoffset: '0' },
          '75%':  { strokeDashoffset: '-38' },
          '100%': { strokeDashoffset: '-38' },
        },
      },
    },
  },
  plugins: [],
}
