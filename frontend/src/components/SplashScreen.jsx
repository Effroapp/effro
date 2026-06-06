/**
 * SplashScreen - full-bleed launch overlay with the A5 reverse-draw.
 *
 * Five-beat sequence:
 *   1. Branches draw from their tips INWARD to the junction (top first, then bot)
 *   2. Stem draws last, from its outer tip inward
 *   3. "Effro" wordmark fades up
 *   4. Mint period dot pops in (small overshoot, like a deliberate full stop)
 *   5. Slogan + effro.io fade up in mono caps
 *
 * Total run time before the hold: roughly 3 seconds.
 *
 * The A5 reverse-draw direction (tips inward) is the same animation used in
 * the inline Logo's hover replay — "things arriving at centre" reads as the
 * second-brain metaphor in motion. Top branch carries the mint accent;
 * stem and lower branch are paper-on-pitch.
 *
 * Props:
 *   visible - when true, splash is shown. Set false once the app is ready.
 *   tagline - optional override for the default "Stay across everything".
 */
export default function SplashScreen({ visible = true, tagline = 'Stay across everything' }) {
  return (
    <>
      <style>{`
        /* Reverse-draw: paths are written tip → junction so the standard
           dashoffset → 0 transition reveals them from the outer end inward.
           Top branch first, then bottom branch ~150ms later, then stem last. */
        @keyframes effroSplashTop {
          0%   { stroke-dashoffset: 38; }
          22%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes effroSplashBot {
          0%, 8% { stroke-dashoffset: 38; }
          30%    { stroke-dashoffset: 0; }
          100%   { stroke-dashoffset: 0; }
        }
        @keyframes effroSplashStem {
          0%, 25% { stroke-dashoffset: 30; }
          47%     { stroke-dashoffset: 0; }
          100%    { stroke-dashoffset: 0; }
        }
        @keyframes effroSplashWord {
          0%, 47%  { opacity: 0; transform: translateY(6px); }
          63%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes effroSplashDot {
          0%, 63%  { opacity: 0; transform: scale(0); }
          73%      { opacity: 1; transform: scale(1.3); }
          80%      { opacity: 1; transform: scale(1); }
          100%     { opacity: 1; transform: scale(1); }
        }
        @keyframes effroSplashSlogan {
          0%, 80%  { opacity: 0; transform: translateY(4px); }
          93%      { opacity: 0.55; transform: translateY(0); }
          100%     { opacity: 0.55; transform: translateY(0); }
        }
        @keyframes effroSplashDomain {
          0%, 88%  { opacity: 0; }
          100%     { opacity: 0.32; }
        }
        .effro-splash-top {
          stroke-dasharray: 38;
          animation: effroSplashTop 3s cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }
        .effro-splash-bot {
          stroke-dasharray: 38;
          animation: effroSplashBot 3s cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }
        .effro-splash-stem {
          stroke-dasharray: 30;
          animation: effroSplashStem 3s cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }
        .effro-splash-word {
          opacity: 0;
          animation: effroSplashWord 3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .effro-splash-dot {
          opacity: 0;
          transform: scale(0);
          animation: effroSplashDot 3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .effro-splash-slogan {
          opacity: 0;
          animation: effroSplashSlogan 3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .effro-splash-domain {
          opacity: 0;
          animation: effroSplashDomain 3.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .effro-splash-stem,
          .effro-splash-top,
          .effro-splash-bot,
          .effro-splash-word,
          .effro-splash-dot,
          .effro-splash-slogan,
          .effro-splash-domain {
            animation: none;
            stroke-dashoffset: 0;
            opacity: 1;
            transform: none;
          }
          .effro-splash-slogan { opacity: 0.55; }
          .effro-splash-domain { opacity: 0.32; }
        }
      `}</style>

      <div
        role="status"
        aria-live="polite"
        aria-label="Loading Effro"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: '#0F0E0C',
          color: '#F7F4ED',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.5rem',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transition: 'opacity 400ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          fontFamily: "'Geist Sans', system-ui, -apple-system, sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <svg
          width="96"
          height="96"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Top branch — MINT — drawn tip → junction (reverse-draw) */}
          <path
            className="effro-splash-top"
            d="M 78 22 Q 64 42, 50 50"
            stroke="#10B981"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Bottom branch — paper — drawn tip → junction */}
          <path
            className="effro-splash-bot"
            d="M 78 78 Q 64 58, 50 50"
            stroke="#F7F4ED"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Stem — paper — drawn tip → junction, last */}
          <path
            className="effro-splash-stem"
            d="M 22 50 L 50 50"
            stroke="#F7F4ED"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div
          className="effro-splash-word"
          style={{
            fontSize: '2.4rem',
            fontWeight: 500,
            letterSpacing: '-0.045em',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'baseline',
          }}
        >
          Effro
          <span
            className="effro-splash-dot"
            aria-hidden="true"
            style={{
              width: '0.20em',
              height: '0.20em',
              borderRadius: '50%',
              background: '#10B981',
              display: 'inline-block',
              marginLeft: '0.06em',
              flexShrink: 0,
              transformOrigin: 'center',
            }}
          />
        </div>

        <div
          className="effro-splash-slogan"
          style={{
            fontSize: '0.65rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
          }}
        >
          {tagline}
        </div>

        {/* Domain stamp — quietly anchored bottom-centre, last to appear.
            Faintly present so it doesn't compete with the wordmark, but
            establishes the brand at effro.io for the launch screen. */}
        <div
          className="effro-splash-domain"
          style={{
            position: 'absolute',
            bottom: '2.5rem',
            fontSize: '0.6rem',
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            color: '#F7F4ED',
          }}
        >
          effro.io
        </div>
      </div>
    </>
  )
}
