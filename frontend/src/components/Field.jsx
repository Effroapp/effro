/**
 * Field - one labelled form control, for input, textarea and select.
 *
 * This is not a new idea. `function Field({ label, hint, value, onChange,
 * placeholder, type, autoComplete })` already existed FOUR times in this
 * codebase with the same signature and the same body, in GoogleIntegration,
 * JiraIntegration, MicrosoftIntegration and SystemSettings, with a fifth copy
 * inlined inside CredentialIntegrationCard's fields.map. The codebase had
 * already voted for a component. It just had five of it.
 *
 * Across the 86 form controls in the app there were 29 distinct shapes, and the
 * one that mattered was the dark border: dark:border-pitch-400, -pitch-500 and
 * dark:border-paper-700 were all in use, and on a #181714 card those read as
 * three different greys, so two forms on adjacent pages did not match. pitch-500
 * wins here: it is the most used, it is the quietest of the three on a card, and
 * phase 1 already settled the page hairline on it, so the form and the page now
 * agree.
 *
 * FOCUS. No offset on the ring, deliberately. The global :focus-visible rule
 * uses ring-offset-2 with ring-offset-paper / dark:ring-offset-pitch, which is
 * right on the page ground and wrong on a card: a field on bg-white or
 * dark:bg-pitch-700 gets a 2px gap painted in the page colour, which reads as a
 * halo. A field cannot know what it is sitting on, so it hugs its own border
 * instead and the question does not arise.
 *
 * Props
 *   as            'input' (default) | 'textarea' | 'select'
 *   label         optional. Rendered as a real <label>, tied by id.
 *   hint          optional quiet line under the control.
 *   error         optional. Replaces hint, turns the border terracotta, and
 *                 announces itself.
 *   mono          Geist Mono. For keys, IDs, tokens and URLs, where character
 *                 shapes have to be unambiguous. The integration forms use it.
 *   value/onChange  onChange receives the VALUE, not the event, matching the
 *                 five components this replaces.
 *   className     merged onto the control, for the rare site that is not w-full.
 *   Everything else spreads onto the control.
 *
 * FIELD_CLASS is exported for the handful of controls this cannot wrap: a
 * borderless search input inside its own bordered box, an inline title that has
 * to look like text until focused, a checkbox. Wearing the class is the escape
 * hatch; the component is the default.
 */
import { useId } from 'react'

export const FIELD_CLASS = [
  'w-full px-3 py-2 text-sm rounded-md',
  'bg-white dark:bg-pitch-800',
  'border border-paper-300 dark:border-pitch-500',
  'text-pitch-800 dark:text-white',
  'placeholder:text-paper-500 dark:placeholder:text-paper-600',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-0',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-colors',
].join(' ')

export default function Field({
  as = 'input',
  label,
  hint,
  error,
  mono = false,
  value,
  onChange,
  className = '',
  ...props
}) {
  const id = useId()
  const Tag = as
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-medium text-pitch-700 dark:text-paper-300 block mb-1.5"
        >
          {label}
        </label>
      )}
      <Tag
        id={id}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${FIELD_CLASS} ${mono ? 'font-mono' : ''} ${
          error ? 'border-terracotta dark:border-terracotta' : ''
        } ${className}`}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-2xs text-terracotta">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-2xs text-paper-500 dark:text-paper-600">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
