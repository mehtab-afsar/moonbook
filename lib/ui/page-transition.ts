/**
 * Shared enter/exit maps for the list<->detail ViewTransition wrapper: a
 * plain Suspense reveal (loading.tsx skeleton -> content) uses "slide-up" by
 * default, while a Link tagged transitionTypes={['nav-forward'|'nav-back']}
 * gets the directional slide instead. See app/globals.css for the CSS and
 * node_modules/next/dist/docs/01-app/02-guides/view-transitions.md for the
 * recipe this follows.
 */
export const pageEnter = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "slide-up",
} as const;

export const pageExit = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
} as const;
