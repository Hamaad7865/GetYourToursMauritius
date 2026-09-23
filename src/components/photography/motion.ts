/**
 * Focus cards: hovering one card of a group pulls the others out of focus (blurred, dimmed), so
 * the eye lands on the one under the pointer. A CSS-only port of Aceternity UI's Focus Cards
 * (21st.dev/@aceternity) — `:has()` on the grid instead of per-card hover state, so hovering the
 * gap between cards blurs nothing and there is no client JS at all.
 *
 * `filter` only: the grid's children are also animated by RevealGroup (opacity/transform), and
 * touching either of those here would fight it. Reduced motion keeps the focus change but drops the
 * transition, so nothing moves.
 */
export const FOCUS_CARDS =
  '[&>*]:transition-[filter] [&>*]:duration-500 [&>*]:ease-out motion-reduce:[&>*]:transition-none [&:has(>:hover)>:not(:hover)]:blur-[3px] [&:has(>:hover)>:not(:hover)]:brightness-[0.72] [&:has(>:hover)>:not(:hover)]:saturate-[0.8]';
