import { useState, useEffect } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Copy, Check, Clock } from 'lucide-react'
import { format } from 'date-fns'
import Modal from './Modal'
import { areasApi } from '../api/client'

export default function WeeklyRoundupModal({ isOpen, onClose }) {
  const [phase, setPhase] = useState('loading')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [dotStep, setDotStep] = useState(0)
  const [generatedAt, setGeneratedAt] = useState('')
  const [staleAreas, setStaleAreas] = useState([])

  useEffect(() => {
    if (phase !== 'loading') return
    const id = setInterval(() => setDotStep((s) => (s + 1) % 3), 600)
    return () => clearInterval(id)
  }, [phase])

  const handleGenerate = async () => {
    setPhase('loading')
    setError('')
    setText('')
    try {
      const data = await areasApi.getRoundupData()
      setGeneratedAt(data.generated_at)
      setStaleAreas(data.stale_areas || [])
      const result = await areasApi.generateRoundup({
        areas: data.areas,
        period_days: data.period_days,
        generated_at: data.generated_at,
      })
      setText(result.text)
      setPhase('review')
    } catch (e) {
      const msg = e.message || 'Unknown error'
      setError(
        msg.includes('ANTHROPIC_API_KEY')
          ? 'API key not configured - add ANTHROPIC_API_KEY to your .env file and rebuild.'
          : msg
      )
      setPhase('error')
    }
  }

  useEffect(() => {
    if (isOpen) handleGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const formattedDate = generatedAt
    ? format(new Date(generatedAt), 'dd MMM yyyy')
    : format(new Date(), 'dd MMM yyyy')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Weekly Roundup" width="max-w-2xl">
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-colors duration-150 ${
                  i === dotStep
                    ? 'bg-mint'
                    : 'bg-paper-300 dark:bg-pitch-500'
                }`}
              />
            ))}
          </div>
          <p className="font-display uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600">
            Generating weekly roundup…
          </p>
        </div>
      )}

      {phase === 'review' && (
        <div>
          <p className="font-display uppercase tracking-widest text-xs text-paper-500 dark:text-paper-600 mb-3">
            Weekly Roundup - W/E {formattedDate}
          </p>

          {staleAreas.length > 0 && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-mustard/5 dark:bg-mustard/10 border border-mustard/30">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Clock size={12} className="text-mustard" />
                <span className="font-display uppercase tracking-widest text-xs text-mustard">
                  Quiet · 14+ days
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {staleAreas.map((a) => (
                  <RouterLink
                    key={a.id}
                    to={`/area/${a.id}`}
                    onClick={onClose}
                    className="text-xs text-pitch-500 dark:text-paper-300 hover:text-paper-700 dark:hover:text-paper-200 transition-colors"
                  >
                    <span className="font-display uppercase tracking-wide">{a.name}</span>
                    <span className="ml-1.5 font-mono text-paper-500 dark:text-paper-600">{a.days_inactive}d</span>
                  </RouterLink>
                ))}
              </div>
            </div>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="
              w-full min-h-[320px] px-3 py-2.5 rounded-lg text-sm font-sans leading-relaxed resize-y
              bg-paper-100 dark:bg-pitch-700
              border border-paper-300 dark:border-paper-700
              text-pitch-700 dark:text-paper-200
              focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent
            "
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={handleCopy}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display uppercase tracking-wide transition-colors
                bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-400
                hover:bg-paper-300 dark:hover:bg-pitch-500
              "
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={onClose}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display uppercase tracking-wide transition-colors
                bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-400
                hover:bg-paper-300 dark:hover:bg-pitch-500
              "
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-6 flex flex-col items-center gap-4">
          <p className="text-sm text-terracotta text-center">{error}</p>
          <button
            onClick={handleGenerate}
            className="
              px-4 py-2 rounded-md text-xs font-display uppercase tracking-wide transition-colors
              bg-paper-200 dark:bg-pitch-700 text-paper-700 dark:text-paper-400
              hover:bg-paper-300 dark:hover:bg-pitch-500
            "
          >
            Try again
          </button>
        </div>
      )}
    </Modal>
  )
}
