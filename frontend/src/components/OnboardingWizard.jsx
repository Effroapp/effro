/**
 * OnboardingWizard — 8-step first-run experience for Effro.
 *
 * Architecture:
 *   - Modal steps: centred card over a soft dark overlay.
 *   - Spotlight steps: a transparent "hole" element uses box-shadow to dim
 *     the entire screen except the targeted element. The tooltip card floats
 *     alongside. The underlying element remains fully interactive.
 *
 * Persistence:
 *   - Completion stored in localStorage under STORAGE_KEY.
 *   - Expose `startOnboarding()` via the hook for replay from the Help drawer.
 *
 * Data attributes required on host elements (added in Sidebar.jsx / App.jsx):
 *   data-onboarding="sidebar-areas"   — the area list section in the sidebar
 *   data-onboarding="main-content"    — the main scrollable content region
 *   data-onboarding="signals-nav"     — the Signals nav item
 *   data-onboarding="smart-gen-nav"   — the Smart Generate nav item
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ArrowRight, Mail, ChevronLeft } from 'lucide-react'

const STORAGE_KEY = 'effro_onboarding_v1'

/* ─── Step definitions ────────────────────────────────────────────────────── */

const STEPS = [
  {
    id: 'welcome',
    type: 'modal',
    title: 'Welcome to Effro.',
    body: "We're glad you're here. Let's take two minutes to show you around so you can get the most out of it, straight away.",
    cta: 'Get started',
  },
  {
    id: 'problem',
    type: 'modal',
    title: 'Finding it difficult to keep all the spinning plates in the air?',
    body: "Most professionals juggle more than they can comfortably hold. Client work, internal projects, meetings, decisions, blockers, scattered across emails, chats, and sticky notes. Nothing connects. Nothing surfaces. Important things slip.\n\nEffro was built to change that.",
    cta: 'Show me how',
  },
  {
    id: 'areas',
    type: 'spotlight',
    target: '[data-onboarding="sidebar-areas"]',
    placement: 'right',
    title: 'Every plate gets an Area.',
    body: "Each Area is one plate you are spinning, a client, a project, a responsibility. Set up one per thing you own. Effro starts empty and shapes itself around you.",
    cta: 'Next',
  },
  {
    id: 'threads',
    type: 'spotlight',
    target: '[data-onboarding="main-content"]',
    placement: 'bottom',
    title: 'Threads hold the work. Entries hold the detail.',
    body: "Inside each Area, Threads are the individual strands of work. Inside each Thread, Entries are the atomic record: todos, decisions, meetings, notes, and blockers. Everything captured, nothing scattered.",
    cta: 'Next',
  },
  {
    id: 'ai',
    type: 'modal',
    title: 'AI keeps you oriented, quietly.',
    body: "Every Area gets a two-sentence overview that refreshes daily. Step away for a week, come back, and you are immediately up to speed. No digging, no re-reading. The Weekly Roundup drafts your status update in one click.",
    cta: 'Next',
  },
  {
    id: 'signals',
    type: 'spotlight',
    target: '[data-onboarding="signals-nav"]',
    placement: 'right',
    title: 'Your tools feed you automatically.',
    body: "Connect Microsoft 365 and Jira in Settings, under Integrations. Once connected, Outlook meetings and Jira issues arrive in Signals every 30 minutes, ready to triage. Accept, reassign, or dismiss. Nothing files itself without you.",
    cta: 'Next',
  },
  {
    id: 'generate',
    type: 'spotlight',
    target: '[data-onboarding="smart-gen-nav"]',
    placement: 'right',
    title: 'Drag. Drop. Done.',
    body: "Got an email, a meeting transcript, or a PDF? Drag it into Smart Generate and Effro extracts the todos, decisions, and context for you to approve. No copy-paste. Drop the mess in, get structured items out.",
    cta: 'Next',
  },
  {
    id: 'commitment',
    type: 'modal',
    variant: 'commitment',
    title: 'Designed for you. With you.',
    body: "Effro was built with attention regulation and executive function in mind. It is intentionally designed to not nudge, nag, or shout for your attention. It holds what you need, surfaces it when you look, and stays quiet otherwise.\n\nThat is our commitment.\n\nThe second it stops serving you, tell us. We will do our absolute utmost to make it better.",
    email: 'feedback@effro.io',
    cta: 'Start using Effro',
  },
]

/* ─── Spotlight hook ──────────────────────────────────────────────────────── */

function useSpotlightRect(selector, active) {
  const [rect, setRect] = useState(null)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!active || !selector) { setRect(null); return }
    const measure = () => {
      const el = document.querySelector(selector)
      if (el) {
        setRect(el.getBoundingClientRect())
      }
    }
    measure()
    // Re-measure on resize/scroll so spotlight tracks the element
    window.addEventListener('resize', measure, { passive: true })
    window.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [selector, active])

  return rect
}

/* ─── Tooltip placement ───────────────────────────────────────────────────── */

const CARD_W = 340
const CARD_H = 220
const PAD = 12  // gap between spotlight and card

function calcCardPos(rect, placement) {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }
  const vw = window.innerWidth
  const vh = window.innerHeight

  const pos = {}
  if (placement === 'right') {
    pos.left = Math.min(rect.right + PAD, vw - CARD_W - 12)
    pos.top  = Math.max(12, Math.min(rect.top + rect.height / 2 - CARD_H / 2, vh - CARD_H - 12))
  } else if (placement === 'bottom') {
    pos.left = Math.max(12, Math.min(rect.left + rect.width / 2 - CARD_W / 2, vw - CARD_W - 12))
    pos.top  = Math.min(rect.bottom + PAD, vh - CARD_H - 12)
  } else {
    pos.left = Math.max(12, Math.min(rect.left + rect.width / 2 - CARD_W / 2, vw - CARD_W - 12))
    pos.top  = Math.max(12, rect.top - CARD_H - PAD)
  }
  return { top: pos.top, left: pos.left }
}

/* ─── Card component ──────────────────────────────────────────────────────── */

function StepCard({ step, index, total, onNext, onBack, onSkip, style, asModal }) {
  const isFirst       = index === 0
  const isLast        = index === total - 1
  const isCommitment  = step.variant === 'commitment'
  const progress      = ((index + 1) / total) * 100

  return (
    <div
      style={{
        position: asModal ? 'relative' : 'fixed',
        width: CARD_W,
        zIndex: 1002,
        background: 'var(--pitch-2, var(--pitch-2))',
        border: '1px solid var(--stone-dark, var(--stone-dark))',
        borderRadius: 16,
        boxShadow: '0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06)',
        overflow: 'hidden',
        animation: 'owFadeUp .22s cubic-bezier(.2,.8,.2,1) both',
        ...style,
      }}
    >
      {/* Mint progress bar */}
      <div style={{ height: 3, background: 'var(--stone-dark, var(--stone-dark))' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--mint, var(--mint))',
          transition: 'width .4s cubic-bezier(.65,0,.35,1)',
          borderRadius: 3,
        }} />
      </div>

      <div style={{ padding: '20px 22px 18px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
          <span style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
            color: 'var(--mint, var(--mint))',
          }}>
            {index + 1} of {total}
          </span>
          <button
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--paper-md, var(--paper-muted-d))', lineHeight: 1,
              transition: 'color .15s',
            }}
            title="Skip tour"
          >
            <X size={14} />
          </button>
        </div>

        {/* Title */}
        <h2 style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: isFirst || isCommitment ? 18 : 16,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1.3,
          color: 'var(--paper-d, var(--paper-d))',
          marginBottom: 10,
        }}>
          {step.title}
        </h2>

        {/* Body */}
        {step.body.split('\n\n').map((para, i) => (
          <p key={i} style={{
            fontFamily: "'Lexend', 'Geist Sans', sans-serif",
            fontSize: 13, fontWeight: 300,
            lineHeight: 1.65,
            color: 'var(--paper-sd, var(--paper-soft-d))',
            marginBottom: 8,
          }}>
            {para}
          </p>
        ))}

        {/* Email link for commitment step */}
        {step.email && (
          <a
            href={`mailto:${step.email}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 6, marginBottom: 2,
              fontFamily: "'Geist Mono', monospace",
              fontSize: 12, letterSpacing: '.04em',
              color: 'var(--mint, var(--mint))',
              textDecoration: 'none',
            }}
          >
            <Mail size={13} />
            {step.email}
          </a>
        )}

        {/* Nav buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          {!isFirst && (
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: '1px solid var(--stone-dark, var(--stone-dark))',
                borderRadius: 7, padding: '7px 12px',
                color: 'var(--paper-sd, var(--paper-soft-d))',
                cursor: 'pointer', fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 5,
                fontFamily: "'Geist Sans', sans-serif",
                transition: 'border-color .15s, color .15s',
              }}
              title="Back"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <button
            onClick={onNext}
            style={{
              flex: 1,
              background: isLast ? 'var(--mint-button, var(--mint-button))' : 'var(--pitch-3, var(--pitch-3))',
              border: `1px solid ${isLast ? 'transparent' : 'var(--stone-dark, var(--stone-dark))'}`,
              borderRadius: 7, padding: '8px 14px',
              color: isLast ? '#fff' : 'var(--paper-d, var(--paper-d))',
              cursor: 'pointer', fontSize: 13, fontWeight: isLast ? 600 : 400,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontFamily: "'Geist Sans', sans-serif",
              transition: 'background .15s, transform .1s',
            }}
          >
            {step.cta}
            {!isLast && <ArrowRight size={13} />}
          </button>
        </div>

        {/* Skip link — not on last step */}
        {!isLast && (
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button
              onClick={onSkip}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase',
                color: 'var(--paper-md, var(--paper-muted-d))',
                transition: 'color .15s',
              }}
            >
              Skip tour
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes owFadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ─── Main wizard component ───────────────────────────────────────────────── */

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)

  const current = STEPS[step]
  const isSpotlight = current.type === 'spotlight'
  const rect = useSpotlightRect(current.target, isSpotlight)
  const cardPos = calcCardPos(rect, current.placement)

  const complete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed: true, completedAt: Date.now() }))
    setVisible(false)
    setTimeout(() => onComplete?.(), 280)
  }, [onComplete])

  const next = () => step < STEPS.length - 1 ? setStep(s => s + 1) : complete()
  const back = () => step > 0 && setStep(s => s - 1)
  const skip = complete

  if (!visible) return null

  /* ── Spotlight step ─────────────────────────────────────── */
  if (isSpotlight) {
    const GUTTER = 8
    const holeStyle = rect ? {
      position: 'fixed',
      top:    rect.top    - GUTTER,
      left:   rect.left   - GUTTER,
      width:  rect.width  + GUTTER * 2,
      height: rect.height + GUTTER * 2,
      borderRadius: 10,
      zIndex: 1000,
      // The box-shadow IS the dark overlay — transparent hole over the element
      boxShadow: '0 0 0 9999px rgba(15,14,12,.85)',
      pointerEvents: 'none',
      transition: 'top .32s cubic-bezier(.65,0,.35,1), left .32s cubic-bezier(.65,0,.35,1), width .32s, height .32s',
    } : null

    return (
      <>
        {/* Click blocker — sits under spotlight hole, catches off-target clicks */}
        <div
          onClick={skip}
          style={{ position: 'fixed', inset: 0, zIndex: 999, cursor: 'default' }}
        />

        {/* Spotlight hole */}
        {holeStyle && <div style={holeStyle} />}

        {/* Tooltip card */}
        <StepCard
          step={current}
          index={step}
          total={STEPS.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
          style={{ position: 'fixed', ...cardPos }}
        />
      </>
    )
  }

  /* ── Modal step ─────────────────────────────────────────── */
  return (
    <>
      {/* Overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,14,12,.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'owBgIn .2s ease both',
      }}>
        <style>{`@keyframes owBgIn { from{opacity:0} to{opacity:1} }`}</style>
        <StepCard
          step={current}
          index={step}
          total={STEPS.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
          asModal
        />
      </div>
    </>
  )
}

/* ─── Hook for external control (Help drawer replay) ─────────────────────── */

export function useOnboarding() {
  const shouldShow = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return true
      const parsed = JSON.parse(stored)
      return !parsed?.completed
    } catch {
      return true
    }
  }, [])

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { shouldShow, resetOnboarding }
}
