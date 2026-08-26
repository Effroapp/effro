import { Loader2 } from 'lucide-react'

/**
 * Button - the one action control.
 *
 * There were 352 button elements across 66 files, and the primary mint action
 * alone was written nine ways: three radii, three vertical paddings, three
 * weight treatments. The look is settled by the .btn classes in index.css. What
 * this component adds is the part a class cannot reach, and that part is where
 * the actual bugs were.
 *
 * WHY A COMPONENT AND NOT JUST THE CLASS.
 *
 * type. 300 of the 352 buttons carried no type attribute, and this app has 12
 * <form> elements. A button with no type inside a form is a submit button, so
 * every one of those is a latent accidental submit. This defaults to
 * type="button" and you opt into submitting.
 *
 * disabled. 76 buttons carried disabled, written across 10 different recipes,
 * and four carried disabled with no disabled styling at all, so they read as
 * fully live while being dead. .btn settles that in one place.
 *
 * loading. Hand-rolled in three shapes across the codebase. Here it is one
 * shape: the icon slot becomes a spinner, the button disables itself so a
 * double submit is impossible, and the label stays put so the button does not
 * change width mid-action.
 *
 * The .btn classes stay exported through index.css for the six call sites this
 * component cannot be: three <Link>, one <a>, IconPicker's render-prop trigger,
 * and the <label> that wraps a hidden file input in FolioView. Those wear
 * "btn btn-md btn-secondary" directly. That is the escape hatch, not the norm.
 *
 * Props
 *   variant   'primary' | 'secondary' | 'ghost' | 'danger'. Default secondary,
 *             because the mint fill is the scarce one and should be asked for.
 *   size      'sm' (px-3 py-1.5 text-xs) | 'md' (px-4 py-2 text-sm). Default md.
 *   icon      a lucide component, not an element. Sized to match: 13 at sm,
 *             15 at md, which is the de facto pairing already in the codebase.
 *   iconRight put the icon after the label instead of before.
 *   loading   swaps the icon for a spinner and disables the button.
 *   className merged last, so a call site's w-full or flex-1 still wins.
 *   Everything else, including type and onClick, spreads onto the button.
 */
/* Written out rather than composed as `btn-${variant}`. Tailwind scans source
   for literal class names, so an interpolated one is never seen and the rule is
   tree-shaken out of the build: btn-ghost and btn-danger were missing from the
   stylesheet entirely until these literals existed, and the component rendered
   an unstyled button with no error anywhere. */
const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}
const SIZES = { sm: { cls: 'btn-sm', icon: 13 }, md: { cls: 'btn-md', icon: 15 } }

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight = false,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  const s = SIZES[size] ?? SIZES.md
  const glyph = loading
    ? <Loader2 size={s.icon} className="animate-spin flex-shrink-0" />
    : Icon ? <Icon size={s.icon} className="flex-shrink-0" /> : null

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`btn ${s.cls} ${VARIANTS[variant] ?? VARIANTS.secondary} ${className}`}
      {...props}
    >
      {!iconRight && glyph}
      {children}
      {iconRight && glyph}
    </button>
  )
}
