'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from 'framer-motion';
import { buttonClass } from '@/components/admin/ui';
import { INSTANT, spring } from '@/components/admin/motion-tokens';
import { IconChevron, IconX } from '@/components/ui/icons';

/* THE BACK OFFICE'S SIDE PANEL: the frame a booking or a quote opens in, over its list.
 *
 * One frame for both, so they behave alike: the list dims behind, Escape closes, Tab stays inside,
 * the page behind holds still, and Previous / Next step through the list as it is shown without
 * closing. What the panel shows is the caller's; it is keyed by the item, so stepping starts it fresh
 * while the frame, and the button just pressed, stay put. Also here: the panel's white card, its
 * "More" menu and the copy icon, so the two panels look the same.
 *
 * Motion is EasyUI's (easyui.site, MIT): the panel springs in like its `sheet` and can be dragged back
 * off to the right by its grip (a pointer convenience only: Close and Escape stay the way out, and a
 * drag asks `mayLeave` like they do); the More menu grows from its button like `origin-dropdown`, with
 * one highlight gliding between its actions. */

/** How far (px) or how fast (px/s) a drag to the right must go before it closes the panel. */
const DRAG_CLOSE_DISTANCE = 140;
const DRAG_CLOSE_VELOCITY = 650;

export const PANEL_CARD_H = 'text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft';
export const PANEL_FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark';

export interface SidePanelProps {
  /** The item shown; when it changes, focus is looked after (see below). */
  itemKey: string;
  /** The id of the panel's heading, which names the dialog. */
  titleId: string;
  /** What the panel holds, for its controls' names: "booking" gives "Previous booking". */
  noun: string;
  /** The items either side in the list as it is filtered and sorted; null at either end. */
  prevId: string | null;
  nextId: string | null;
  /** Where the item sits in that list, or null when the list does not show it. */
  position: { index: number; count: number } | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** Asked before leaving the item (Close, Escape, the dimmed list, Previous, Next). */
  mayLeave: () => boolean;
  children: ReactNode;
}

export function SidePanel({
  itemKey,
  titleId,
  noun,
  prevId,
  nextId,
  position,
  onNavigate,
  onClose,
  mayLeave,
  children,
}: SidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const dragControls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    // Short of the threshold, or refused by mayLeave, the drag constraints spring it back.
    if (info.offset.x > DRAG_CLOSE_DISTANCE || info.velocity.x > DRAG_CLOSE_VELOCITY)
      requestClose();
  };
  const requestClose = useCallback(() => {
    if (mayLeave()) onClose();
  }, [mayLeave, onClose]);
  const go = (target: string | null) => {
    if (target && mayLeave()) onNavigate(target);
  };

  // The page behind holds still while the panel is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Focus moves into the panel when it opens (the list gives it back on close).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // After Previous / Next, focus stays on the button pressed. At the end of the list that button is
  // now disabled, and the browser would drop its focus to the page (a moment after this runs), so it
  // goes to the other step button, or to the panel, instead.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    const lost =
      !active ||
      !panel.contains(active) ||
      (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    (panel.querySelector<HTMLElement>('[data-step]:not([disabled])') ?? panel).focus();
  }, [itemKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
        return;
      }
      // Modal: Tab stays inside the panel.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panelRef.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const navBtn = `grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-muted transition-colors hover:border-[#C2CED1] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${PANEL_FOCUS_RING}`;

  return (
    <div className="fixed inset-0 z-50">
      <motion.button
        type="button"
        aria-label={`Close ${noun} details`}
        tabIndex={-1}
        onClick={requestClose}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduce ? INSTANT : { duration: 0.2, ease: 'easeOut' }}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <motion.section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={reduce ? false : { opacity: 0, x: 48 }}
        animate={{ opacity: 1, x: 0 }}
        transition={reduce ? INSTANT : spring.responsive}
        drag={reduce ? false : 'x'}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.7 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        className="absolute inset-0 flex flex-col overflow-hidden bg-white shadow-[-24px_0_60px_-20px_rgba(10,46,54,0.45)] outline-none sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[min(680px,calc(100%-24px))] sm:rounded-2xl"
      >
        {!reduce && (
          <span
            aria-hidden="true"
            title="Drag right to close"
            onPointerDown={(e) => dragControls.start(e)}
            className="group absolute inset-y-0 left-0 z-[3] hidden w-3 cursor-grab touch-none items-center justify-center active:cursor-grabbing sm:flex"
          >
            <span className="h-10 w-1 rounded-full bg-line transition-colors group-hover:bg-[#9DAEB2] motion-reduce:transition-none" />
          </span>
        )}
        <div className="absolute right-3 top-3 z-[2] flex items-center gap-1.5 sm:right-5 sm:top-4">
          {position && (
            <>
              <span className="mr-1 hidden whitespace-nowrap text-[12px] text-ink-soft sm:inline">
                {position.index + 1} of {position.count}
              </span>
              <button
                type="button"
                onClick={() => go(prevId)}
                disabled={!prevId}
                data-step="prev"
                aria-label={`Previous ${noun}`}
                className={navBtn}
              >
                <IconChevron width={16} height={16} className="rotate-180" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(nextId)}
                disabled={!nextId}
                data-step="next"
                aria-label={`Next ${noun}`}
                className={navBtn}
              >
                <IconChevron width={16} height={16} aria-hidden="true" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={requestClose}
            aria-label={`Close ${noun} details`}
            className={`ml-0.5 grid h-9 w-9 place-items-center rounded-lg bg-ground text-ink transition-colors hover:bg-line-soft motion-reduce:transition-none ${PANEL_FOCUS_RING}`}
          >
            <IconX width={16} height={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </motion.section>
    </div>
  );
}

/** A white card on the panel's grey ground, with a small capitalised heading. */
export function PanelCard({
  title,
  aside,
  id,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      className="scroll-mt-3 rounded-xl border border-line bg-white px-4 py-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-teal-dark/25 sm:px-5"
    >
      {(title || aside) && (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title && <h3 className={PANEL_CARD_H}>{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export interface MenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * "More": every action that is not the item's main one, in groups. A menu button: arrows move,
 * Escape closes it (and only it), choosing closes it and hands focus back before any confirmation
 * appears.
 */
export function MoreMenu({
  groups,
  busyLabel,
  disabled,
}: {
  groups: MenuAction[][];
  busyLabel: string | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** The action the gliding highlight sits on (hovered or focused), or null. */
  const [hi, setHi] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const highlightId = `bo-more-${menuId}`;
  const shown = groups.filter((g) => g.length > 0);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      // Closes the menu, not the panel behind it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const items = Array.from(
        wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (at + 1) % items.length
              : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || shown.length === 0}
        onClick={() => setOpen((o) => !o)}
        className={buttonClass('ghost')}
      >
        {busyLabel ?? 'More'}
        <IconChevron
          width={14}
          height={14}
          aria-hidden="true"
          className={`transition-transform motion-reduce:transition-none ${open ? '' : 'rotate-180'}`}
        />
      </button>
      <AnimatePresence onExitComplete={() => setHi(null)}>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="More actions"
            initial={reduce ? false : { opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.96, y: 4 }}
            transition={reduce ? INSTANT : spring.responsive}
            onMouseLeave={() => setHi(null)}
            className="absolute bottom-full right-0 z-10 mb-2 w-[240px] max-w-[calc(100vw-32px)] origin-bottom-right overflow-hidden rounded-xl border border-line bg-white px-1.5 py-1.5 shadow-[0_16px_40px_-12px_rgba(10,46,54,0.35)]"
          >
            {shown.map((group, gi) => (
              <div
                key={gi}
                role="group"
                className={gi > 0 ? 'mt-1.5 border-t border-line-soft pt-1.5' : ''}
              >
                {group.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onMouseEnter={() => setHi(a.id)}
                    onFocus={() => setHi(a.id)}
                    onClick={() => {
                      setOpen(false);
                      triggerRef.current?.focus();
                      a.onSelect();
                    }}
                    className={`relative isolate flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-medium outline-none ${
                      a.danger ? 'text-coral-dark' : 'text-ink'
                    }`}
                  >
                    {a.label}
                    {hi === a.id && (
                      <motion.span
                        aria-hidden="true"
                        layoutId={highlightId}
                        transition={reduce ? INSTANT : spring.snappy}
                        className={`absolute inset-0 -z-10 rounded-lg ${a.danger ? 'bg-coral-tint' : 'bg-line-soft'}`}
                      />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
