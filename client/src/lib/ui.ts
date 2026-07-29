/**
 * Shared class tokens for the design system. One source of truth so a control
 * looks identical everywhere — add layout utilities (w-full, mt-1) at the call
 * site.
 *
 * `btnPrimary` and `btnAi` now render the same violet. They stay distinct
 * names so the call sites keep saying which is which — an AI trigger also
 * carries the sparkle glyph, which is what actually marks it.
 */

/** Text inputs, textareas, and selects. */
export const inputClassName =
  "block rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted";

/** Native selects need extra right padding for the chevron. */
export const selectClassName = `${inputClassName} cursor-pointer appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748B'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z' clip-rule='evenodd'/%3E%3C/svg%3E")] bg-[length:1.15rem] bg-[right_0.5rem_center] bg-no-repeat pr-9`;

/** Small field label above an input. */
export const labelClassName = "block text-xs font-semibold text-ink";

const btnBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold transition active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

/** Spec default: 44px tall, comfortable as a touch target. */
export const btnSize = "h-11 px-4";
/** Denser variant for controls inside cards and rows. */
export const btnSizeSm = "h-9 px-3 text-[13px]";

export const btnPrimary = `${btnBase} ${btnSize} bg-brand text-white shadow-sm hover:bg-brand-hover`;
export const btnPrimarySm = `${btnBase} ${btnSizeSm} bg-brand text-white shadow-sm hover:bg-brand-hover`;

export const btnSecondary = `${btnBase} ${btnSize} border border-border bg-surface text-ink shadow-sm hover:bg-subtle`;
export const btnSecondarySm = `${btnBase} ${btnSizeSm} border border-border bg-surface text-ink shadow-sm hover:bg-subtle`;

export const btnGhost = `${btnBase} ${btnSize} text-muted hover:bg-subtle hover:text-ink`;
export const btnGhostSm = `${btnBase} ${btnSizeSm} text-muted hover:bg-subtle hover:text-ink`;

/** For actions that invoke a model. Always pair with the sparkle glyph. */
export const btnAi = `${btnBase} ${btnSize} bg-ai text-white shadow-sm hover:bg-ai-hover`;
export const btnAiSm = `${btnBase} ${btnSizeSm} bg-ai text-white shadow-sm hover:bg-ai-hover`;
/** The lower-emphasis AI action (regenerate next to a download, etc.). */
export const btnAiSoft = `${btnBase} ${btnSizeSm} border border-ai-ring bg-ai-soft text-ai hover:bg-ai-ring/50`;

export const btnDangerSm = `${btnBase} ${btnSizeSm} border border-danger-ring bg-surface text-danger shadow-sm hover:bg-danger-soft`;

/** Card surface. 16px radius + 1px border + soft shadow, per the spec. */
export const cardClassName =
  "rounded-2xl border border-border bg-surface shadow-card";

/** Cards that are themselves links/buttons get the 2px hover lift. */
export const cardInteractive = `${cardClassName} transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover`;

/** Section heading inside a card. */
export const cardTitleClassName = "text-base font-bold text-ink";

/** Full-width empty state inside a card or page region. */
export const emptyStateClassName =
  "rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center";
