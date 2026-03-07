/** Shared button class-name constants for consistent styling across all pages. */
export const btn = {
  primary:    "px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold text-sm transition-all shadow-sm",
  secondary:  "px-4 py-2 border border-th-default text-th-primary rounded-lg hover:bg-panel font-medium text-sm transition-colors",
  danger:     "px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold text-sm transition-colors",
  ghost:      "px-4 py-2 text-th-secondary hover:bg-panel hover:text-th-primary rounded-lg font-medium text-sm transition-colors",
  icon:       "p-2 text-th-muted hover:text-primary-500 hover:bg-panel rounded-lg transition-colors",
  iconDanger: "p-2 text-th-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors",
} as const;

/** Shared form input class-name constants. */
export const input = {
  base:   "w-full px-3 py-2 border border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-th-primary rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-th-muted",
  select: "w-full px-3 py-2 border border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-th-primary rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500",
} as const;