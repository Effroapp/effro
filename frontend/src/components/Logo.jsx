/**
 * Effro logo — the curved fork.
 *
 * The mark is V3 from the design exploration: stem on the left, two curved
 * branches sweeping right. The TOP branch carries the mint accent; stem and
 * lower branch are mono (ink, paper, or currentColor). Mint also marks the
 * period in the "Effro." wordmark.
 *
 * The hover redraw uses the **A5 reverse-draw** pattern: strokes draw from
 * their outer tips INWARD to the junction (branches first, stem last). Reads
 * as "things arriving at centre" — the second-brain metaphor in motion.
 *
 * Props:
 *   size         - pixel dimensions for the mark (default 32)
 *   variant      - 'auto' (currentColor), 'ink' (#14130F), 'paper' (#F7F4ED)
 *   withText     - when true, renders the wordmark "Effro" with the mint dot
 *   spinOnHover  - animate the strokes on hover (default true)
 *   className    - optional extra classes (applied to outer wrapper if withText)
 */
export default function Logo({
  size = 32,
  variant = 'auto',
  withText = false,
  spinOnHover = true,
  className = '',
}) {
  const stroke = variant === 'ink'
    ? '#14130F'
    : variant === 'paper'
      ? '#F7F4ED'
      : 'currentColor'

  // The mint accent — top branch and wordmark dot. Hex literal so the
  // colour is consistent across light/dark surfaces.
  const mintStroke = '#10B981'

  // Slightly thicker stroke for very small renderings so the form survives.
  const strokeWidth = size <= 24 ? 14 : 11

  // Paths are deliberately written tip → junction so the standard
  // stroke-dashoffset draw-on animation reveals them from the outer end
  // inward (the A5 reverse-draw direction).
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Effro"
      className={spinOnHover ? 'effro-logo-mark' : undefined}
    >
      {/* Top branch — MINT — drawn from tip (78,22) inward to junction (50,50) */}
      <path
        className={spinOnHover ? 'effro-logo-top' : undefined}
        d="M 78 22 Q 64 42, 50 50"
        stroke={mintStroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom branch — ink — drawn from tip (78,78) inward */}
      <path
        className={spinOnHover ? 'effro-logo-bot' : undefined}
        d="M 78 78 Q 64 58, 50 50"
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Stem — ink — drawn from tip (22,50) inward, last */}
      <path
        className={spinOnHover ? 'effro-logo-stem' : undefined}
        d="M 22 50 L 50 50"
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )

  if (!withText) return (
    <>
      <HoverRedrawStyles />
      {mark}
    </>
  )

  // Lockup: mark + wordmark "Effro" + mint dot.
  // Font size scales with the mark size; mint dot is sized to baseline.
  const wordFontSize = Math.round(size * 0.95)
  const dotSize = Math.round(size * 0.13)

  return (
    <>
      <HoverRedrawStyles />
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: `${size * 0.3}px`,
          color: variant === 'paper' ? '#F7F4ED' : variant === 'ink' ? '#14130F' : 'currentColor',
        }}
      >
        {mark}
        <span
          style={{
            fontFamily: "'Geist Sans', system-ui, -apple-system, sans-serif",
            fontWeight: 500,
            fontSize: `${wordFontSize}px`,
            letterSpacing: '-0.045em',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'baseline',
          }}
        >
          Effro
          <span
            aria-hidden="true"
            style={{
              width: `${dotSize}px`,
              height: `${dotSize}px`,
              borderRadius: '50%',
              background: mintStroke,
              display: 'inline-block',
              marginLeft: `${dotSize * 0.3}px`,
              flexShrink: 0,
            }}
          />
        </span>
      </span>
    </>
  )
}

/**
 * Inline keyframes for the A5 reverse-draw hover animation.
 *
 * Static state: all three strokes fully visible.
 * On hover (or any ancestor with `.group:hover`):
 *   - Both branches start invisible and draw from tip inward to junction
 *     (branches drawing in slight stagger — top, then bot ~150ms later)
 *   - Stem starts invisible, draws last (delay ~400ms) from its tip inward
 *
 * Each path is reversed at the path-direction level (tip → junction) so the
 * standard stroke-dashoffset 60 → 0 transition draws from the outer tip
 * inward. No negative dashoffsets needed; behaves consistently across
 * browsers / WebView2.
 *
 * prefers-reduced-motion suppresses everything — strokes just stay visible.
 *
 * The component renders the <style> tag inline so the Logo stays fully
 * self-contained — no external CSS dependency.
 */
function HoverRedrawStyles() {
  return (
    <style>{`
      /* Resting state: strokes fully visible */
      .effro-logo-mark .effro-logo-stem,
      .effro-logo-mark .effro-logo-top,
      .effro-logo-mark .effro-logo-bot {
        stroke-dasharray: 60;
        stroke-dashoffset: 0;
      }
      /* Reverse-draw keyframes — start invisible (offset 60),
         finish fully drawn (offset 0). Because the paths are written
         tip → junction, this draws from the outer end inward. */
      @keyframes effroLogoTop {
        0%   { stroke-dashoffset: 60; }
        45%  { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes effroLogoBot {
        0%, 12%  { stroke-dashoffset: 60; }
        55%      { stroke-dashoffset: 0; }
        100%     { stroke-dashoffset: 0; }
      }
      @keyframes effroLogoStem {
        0%, 35%  { stroke-dashoffset: 60; }
        70%      { stroke-dashoffset: 0; }
        100%     { stroke-dashoffset: 0; }
      }
      /* Hover triggers — either the SVG itself or any group ancestor */
      .effro-logo-mark:hover .effro-logo-top,
      .group:hover .effro-logo-mark .effro-logo-top {
        animation: effroLogoTop 1.2s cubic-bezier(0.65, 0, 0.35, 1) forwards;
      }
      .effro-logo-mark:hover .effro-logo-bot,
      .group:hover .effro-logo-mark .effro-logo-bot {
        animation: effroLogoBot 1.2s cubic-bezier(0.65, 0, 0.35, 1) forwards;
      }
      .effro-logo-mark:hover .effro-logo-stem,
      .group:hover .effro-logo-mark .effro-logo-stem {
        animation: effroLogoStem 1.2s cubic-bezier(0.65, 0, 0.35, 1) forwards;
      }
      /* Respect prefers-reduced-motion — kill all animation */
      @media (prefers-reduced-motion: reduce) {
        .effro-logo-mark:hover .effro-logo-top,
        .effro-logo-mark:hover .effro-logo-bot,
        .effro-logo-mark:hover .effro-logo-stem,
        .group:hover .effro-logo-mark .effro-logo-top,
        .group:hover .effro-logo-mark .effro-logo-bot,
        .group:hover .effro-logo-mark .effro-logo-stem {
          animation: none;
        }
      }
    `}</style>
  )
}
