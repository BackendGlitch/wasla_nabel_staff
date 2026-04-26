/**
 * Kiosk design tokens.
 *
 * Single source of truth for touch sizes, spacing, typography and colors used
 * by every kiosk screen and component. The values here are deliberately
 * larger than the legacy desktop UI so that fingers, not mice, are the primary
 * input device on a 1024x768-class POS terminal.
 *
 * No component consumes these tokens yet — Step 1 (foundation) only adds the
 * constants. They are wired up by `KioskShell` and the screens in Step 2+.
 */

/** Tap target sizes (height and width in pixels). */
export const TouchSize = {
  /** Absolute minimum for any interactive element. */
  min: 56,
  /** Default size for icon buttons in the top bar / row actions. */
  icon: 56,
  /** Secondary action button height (Annuler, Changer, Réimprimer). */
  secondary: 48,
  /** Primary CTA button height (Réserver, Confirmer, Imprimer). */
  primary: 64,
  /** Queue / settings row (also used by selectable list items). */
  row: 64,
  /** Bottom navigation tab height. */
  navTab: 72,
  /** Destination tile minimum height on the home grid. */
  tile: 128,
  /** Seat-count pad button. */
  seatPad: 64,
} as const;

/** Spacing scale (px). All gaps between tap targets must be >= TouchSize.min/4. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Typography scale (px). Body must be >= 16 for readability at arm's length. */
export const FontSize = {
  caption: 12,
  body: 16,
  bodyLg: 18,
  heading: 20,
  headingLg: 24,
  display: 32,
} as const;

/** Semantic color tokens — Tailwind utility classes for consistency. */
export const Color = {
  surface: 'bg-slate-50',
  surfaceCard: 'bg-white',
  surfaceMuted: 'bg-slate-100',
  surfaceGhost: 'bg-violet-50/30',
  border: 'border-slate-200',
  textPrimary: 'text-slate-900',
  textSecondary: 'text-slate-600',
  textMuted: 'text-slate-400',
  primary: 'bg-blue-600',
  primaryHover: 'hover:bg-blue-700',
  primaryText: 'text-white',
  success: 'bg-emerald-600',
  successHover: 'hover:bg-emerald-700',
  danger: 'bg-red-600',
  dangerHover: 'hover:bg-red-700',
  ghost: 'bg-violet-600',
  ghostHover: 'hover:bg-violet-700',
  /** Soft ghost surface for badges / selected chips. */
  ghostBg: 'bg-violet-100',
  ghostText: 'text-violet-700',
} as const;

/**
 * Z-index scale. The notification toast must always be above modals which must
 * always be above the screen content.
 */
export const ZIndex = {
  content: 0,
  bottomNav: 10,
  topBar: 20,
  modalBackdrop: 40,
  modal: 41,
  toast: 60,
} as const;

/** Animation durations in ms. */
export const Duration = {
  fast: 120,
  base: 200,
  slow: 300,
} as const;
