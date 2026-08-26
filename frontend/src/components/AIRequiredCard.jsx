import { Link } from 'react-router-dom'
import { Cpu, ArrowRight } from 'lucide-react'

/**
 * Full-bleed empty state shown in place of an AI-dependent feature when
 * no engine is configured.
 *
 * Used by Smart Generate. Avoids the worst UX - letting the user paste
 * text or drop a file before discovering AI isn't set up.
 *
 * Tone matches the rest of the app: direct, no surprises, predictable
 * destination (link to /settings rather than a popover or modal).
 */
export default function AIRequiredCard({ feature = 'This feature' }) {
  return (
    <div className="
      max-w-xl mx-auto mt-12
      rounded-xl border-2 border-dashed
      border-paper-300 dark:border-pitch-500
      bg-white dark:bg-pitch-700
      p-8 text-center
    ">
      <div className="
        w-12 h-12 mx-auto mb-4 rounded-full
        bg-mint-50 dark:bg-mint-900/20
        flex items-center justify-center
      ">
        <Cpu size={20} className="text-mint-700 dark:text-mint-300" />
      </div>
      <h2 className="font-sans font-medium text-lg text-pitch-800 dark:text-white mb-2">
        {feature} needs an AI engine
      </h2>
      <p className="text-sm text-paper-600 dark:text-paper-500 mb-6 leading-relaxed">
        Pick a provider and paste a key - takes about 2 minutes.
        Free options available (Groq, Gemini, Ollama).
      </p>
      <Link
        to="/settings"
        className="
          inline-flex items-center gap-1.5
          px-4 py-2.5 rounded-md
          bg-mint-700 hover:bg-mint-800 text-white
          font-sans font-medium uppercase tracking-wide text-xs
          transition-colors
        "
      >
        Set up AI engine
        <ArrowRight size={12} />
      </Link>
    </div>
  )
}
