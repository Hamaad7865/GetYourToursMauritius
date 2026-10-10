'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/site/PreferencesProvider';
import { IconChat } from '@/components/ui/icons';
import { usePlannerSession, type SessionPane } from '../usePlannerSession';
import { QuoteModal } from '../QuoteModal';
import { PlannerPrintSheet } from '../PlannerPrintSheet';
import { useZilAi } from './ZilAiProvider';
import { AssistantPanel } from './AssistantPanel';
import { ResultsCanvas } from './ResultsCanvas';
import { IconList, IconMap } from './icons';
import './zilai.css';

/**
 * ZilAi itself: the panel, the results canvas, and the one planner session they share.
 *
 * Mounted by ZilAiProvider the first time the assistant is opened and kept mounted afterwards, so
 * closing the panel (or moving to another page) never loses the conversation or the plan.
 *
 * This component owns only WHERE things are — open or closed, panel alone or panel + canvas, which
 * pane a phone is showing — and writes that onto <html> for the stylesheet. The panel is a modal
 * sheet that slides in from the left over the page; it never moves the page. Everything about the
 * plan lives in `usePlannerSession`.
 */
export function ZilAiDock() {
  const t = useT();
  const pathname = usePathname();
  const { open, close, request, clearRequest, openedOnPath } = useZilAi();
  const [pane, setPane] = useState<SessionPane>('chat');
  const [canvasOpen, setCanvasOpen] = useState(false);
  // The canvas is mounted the first time it is needed and then left mounted (hidden by CSS), so
  // reopening it does not rebuild the map — every rebuild is another billed map load.
  const [canvasEver, setCanvasEver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const showPane = useCallback((next: SessionPane) => {
    setPane(next);
    if (next !== 'chat') {
      setCanvasOpen(true);
      setCanvasEver(true);
    }
  }, []);
  const session = usePlannerSession(showPane);
  const { hasPlan } = session;

  // A plan that arrives without a chat turn (a shared link restored on the planner page) still
  // belongs on the canvas.
  useEffect(() => {
    if (hasPlan) showPane('plan');
  }, [hasPlan, showPane]);
  // …and a session with no plan left has nothing to show there.
  useEffect(() => {
    if (!hasPlan) {
      setCanvasOpen(false);
      setPane('chat');
    }
  }, [hasPlan]);

  // ── what a page asked for as it opened us ──
  // Dates first, the message a render later: sendChat reads the trip from the render it runs in,
  // so sending in the same tick would plan a single day for a visitor who had just picked five.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  useEffect(() => {
    if (!request) return;
    clearRequest();
    if (request.restore) {
      session.newChat();
      session.restoreFromUrl();
      return;
    }
    if (request.tourSlug) {
      // Asked for the tour that is already on the plan: just show it. Reloading would throw away
      // whatever the visitor has changed since.
      if (session.tourSlug === request.tourSlug && session.hasPlan) {
        showPane('plan');
        return;
      }
      session.newChat();
      void session.loadTour(request.tourSlug);
      return;
    }
    if (request.range) session.applyRange(request.range.from, request.range.to);
    if (request.presetId) session.openPreset(request.presetId);
    else if (request.prompt) setPendingPrompt(request.prompt);
    // `session` is a fresh object every render; the request id is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, clearRequest]);
  useEffect(() => {
    if (pendingPrompt === null) return;
    setPendingPrompt(null);
    session.startWith(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  // ── tell the page what to do about us ──
  useEffect(() => {
    const root = document.documentElement;
    if (!open) {
      delete root.dataset.zilai;
      return;
    }
    root.dataset.zilai = canvasOpen ? 'workspace' : 'panel';
    return () => {
      delete root.dataset.zilai;
    };
  }, [open, canvasOpen]);

  // Following a link (a tour's "View & book", a policy link in the chat) means the visitor wants
  // that page: fold the canvas away and close the panel, which sits on top of it.
  // Compared against the last path seen rather than "is this the first run": effects can run again
  // without the path changing (strict mode, hot reload), and a re-run must not fold anything away.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // …unless the page they arrived on is the one that opened us: a shared plan link, or a tour's
    // "customise this" link, lands on the planner page, which opens the assistant as it mounts. Its
    // effect runs before this one, so closing here would shut the panel on the plan it just asked for.
    if (openedOnPath() === window.location.pathname) return;
    setCanvasOpen(false);
    setPane('chat');
    close();
  }, [pathname, close, openedOnPath]);

  // ── keyboard: Escape closes, and Tab stays inside (the assistant covers the page) ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        // Inner layers (menu drawer, quote dialog, date popover) take Escape first and mark it handled.
        if (session.quoteOpen || session.drawerOpen) return;
        close();
        return;
      }
      // The assistant is modal: while it is open, Tab stays inside it.
      if (e.key !== 'Tab') return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, canvasOpen, close, session.quoteOpen, session.drawerOpen]);

  const closeCanvas = useCallback(() => {
    setCanvasOpen(false);
    setPane('chat');
  }, []);

  const tabs: Array<{ id: SessionPane; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: 'Chat', icon: <IconChat width={19} height={19} /> },
    { id: 'plan', label: 'Plan', icon: <IconList width={19} height={19} /> },
    { id: 'map', label: 'Map', icon: <IconMap width={19} height={19} /> },
  ];

  return (
    <>
      <div
        ref={rootRef}
        className="zilai-root"
        data-open={open}
        data-canvas={canvasOpen}
        data-pane={pane}
      >
        <button
          type="button"
          className="zilai-scrim"
          tabIndex={-1}
          aria-label={t('Close ZilAi')}
          onClick={close}
        />

        <aside
          className="zilai-panel"
          // A modal sheet: it covers the page, traps Tab and closes on Escape (see the key handler).
          role="dialog"
          aria-modal="true"
          aria-label={t('ZilAi, the AI trip assistant')}
          // A closed panel is off-screen but still in the DOM — keep it out of the tab order too.
          inert={!open}
        >
          <AssistantPanel
            session={session}
            open={open}
            canvasOpen={canvasOpen}
            onClose={close}
            onOpenPlan={() => showPane('plan')}
          />
        </aside>

        {canvasEver && (
          <section
            className="zilai-canvas"
            aria-label={t('Your plan')}
            inert={!open || !canvasOpen}
          >
            <ResultsCanvas session={session} onClose={closeCanvas} />
          </section>
        )}

        <nav className="zilai-tabs" aria-label={t('Assistant views')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => showPane(tab.id)}
              aria-current={pane === tab.id ? 'page' : undefined}
              className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold transition-colors ${
                pane === tab.id ? 'text-teal-dark' : 'text-ink-muted'
              }`}
            >
              {tab.icon}
              {t(tab.label)}
            </button>
          ))}
        </nav>

        <QuoteModal
          open={session.quoteOpen}
          onClose={() => session.setQuoteOpen(false)}
          stops={session.stops}
          route={session.route}
          quote={session.quote}
          quoteError={session.quoteError}
          maxParty={session.pricing.maxParty}
          date={session.activeDay?.date ?? session.date}
          setDate={session.setDate}
          minDate={session.minDate}
          lockedDate={session.activeDay?.date ?? null}
          time={session.time}
          setTime={session.setTime}
          party={session.party}
          setParty={session.setParty}
          suv={session.suv}
          setSuv={session.setSuv}
          childSeats={session.childSeats}
          setChildSeats={session.setChildSeats}
          booking={session.booking}
          bookError={session.bookError}
          onBook={session.bookDay}
        />
      </div>

      {/* "Print" produces THIS, not the app: see PlannerPrintSheet. Outside .zilai-root, which the
          print stylesheet hides. */}
      <div className="zilai-print">
        <PlannerPrintSheet
          days={session.days}
          stops={session.stops}
          pickup={session.pickup}
          dropoff={session.dropoff}
          quote={session.quote}
          party={session.party}
          date={session.date || session.minDate}
          time={session.time}
          catalog={session.catalog}
          bmtBySlug={session.bmtCatalog}
        />
      </div>
    </>
  );
}
