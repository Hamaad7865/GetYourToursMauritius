'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

/**
 * The site-wide switch for ZilAi, the planning assistant.
 *
 * This file is all that every page pays for: a context and a boolean. The assistant itself
 * (`ZilAiDock` — the panel, the results canvas, the planner session, the map) is fetched the first
 * time someone opens it and is never part of any page's HTML. That matters twice over here: the
 * homepage is edge-cached, so nothing personal may be rendered into it, and a site-wide block of
 * markup would change every page in the middle of an SEO measurement window.
 */

/** Something a page asks the assistant to do as it opens. Consumed once by the dock. */
export interface ZilAiRequest {
  /** Send this as the visitor's first message. */
  prompt?: string;
  /** Load one of the ready-made road trips. */
  presetId?: string;
  /** Load one of our sightseeing tours as the starting point, to be customised. */
  tourSlug?: string;
  /** Set trip dates before anything is sent. */
  range?: { from: string; to: string };
  /** The page's URL carries a plan (a shared link, a tour to customise): load it. Only acted on when
   *  the assistant is ALREADY running — a freshly mounted session reads the URL by itself. */
  restore?: boolean;
}

interface ZilAiContextValue {
  open: boolean;
  /** False on routes where the assistant stays shut (checkout, the back office). A trigger there
   *  should behave as the plain link it is rather than swallow the click and open nothing. */
  available: boolean;
  /** The path the assistant was last opened on. The dock closes the panel when the visitor follows
   *  a link — except onto a page that has just opened it (a shared plan landing on the planner). */
  openedOnPath: () => string | null;
  /** Open the assistant, optionally with something to do. */
  openAssistant: (request?: ZilAiRequest) => void;
  close: () => void;
  /** Start downloading the assistant (hover/focus on a trigger) so the click feels instant. */
  preload: () => void;
  /** The request waiting for the dock, stamped so two identical requests are still two requests. */
  request: (ZilAiRequest & { id: number }) | null;
  clearRequest: () => void;
}

const ZilAiContext = createContext<ZilAiContextValue | null>(null);

const loadDock = () => import('./ZilAiDock').then((m) => m.ZilAiDock);
const ZilAiDock = dynamic(loadDock, { ssr: false });

/** Remembers that the assistant was open, so a full page load (a reload, a non-SPA hop) reopens it. */
const OPEN_KEY = 'gytm:zilai:open';

/** Routes where the assistant must stay out of the way: paying, and the back office. */
function assistantAllowed(pathname: string): boolean {
  const bare = pathname.replace(/^\/fr(?=\/|$)/, '') || '/';
  return !bare.startsWith('/checkout') && !bare.startsWith('/admin');
}

export function ZilAiProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const allowed = assistantAllowed(pathname);
  const [open, setOpen] = useState(false);
  // Once true it stays true: closing hides the dock but keeps the session it holds.
  const [mounted, setMounted] = useState(false);
  const [request, setRequest] = useState<ZilAiContextValue['request']>(null);
  const requestId = useRef(0);
  const mountedRef = useRef(false);
  /** What had focus when the assistant was opened, so closing it can hand focus back. */
  const openerRef = useRef<HTMLElement | null>(null);

  const openedOnPathRef = useRef<string | null>(null);
  const openedOnPath = useCallback(() => openedOnPathRef.current, []);

  const openAssistant = useCallback((next?: ZilAiRequest) => {
    // Never "open" where the assistant is not shown: the state would flip, nothing would appear,
    // and the panel would then spring open by itself on the next allowed page.
    if (!assistantAllowed(window.location.pathname)) return;
    openedOnPathRef.current = window.location.pathname;
    const restore = Boolean(next?.restore) && mountedRef.current;
    if (next && (next.prompt || next.presetId || next.tourSlug || next.range || restore)) {
      requestId.current += 1;
      setRequest({ ...next, restore, id: requestId.current });
    }
    if (document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    mountedRef.current = true;
    setMounted(true);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    // Only if it is still on the page — a link followed since then is gone.
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }, []);
  const preload = useCallback(() => void loadDock(), []);
  const clearRequest = useCallback(() => setRequest(null), []);

  // Reopen after a full page load if it was open before.
  useEffect(() => {
    try {
      if (
        window.sessionStorage.getItem(OPEN_KEY) === '1' &&
        assistantAllowed(window.location.pathname)
      ) {
        mountedRef.current = true;
        setMounted(true);
        setOpen(true);
      }
    } catch {
      /* storage blocked — the assistant just starts closed */
    }
  }, []);
  useEffect(() => {
    if (!mounted) return;
    try {
      window.sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* nothing to remember it with */
    }
  }, [open, mounted]);

  // Booking from the assistant ends on /checkout — get out of the way of the payment.
  useEffect(() => {
    if (!allowed) setOpen(false);
  }, [allowed]);

  const value = useMemo(
    () => ({
      open: open && allowed,
      available: allowed,
      openedOnPath,
      openAssistant,
      close,
      preload,
      request,
      clearRequest,
    }),
    [open, allowed, openedOnPath, openAssistant, close, preload, request, clearRequest],
  );

  return (
    <ZilAiContext.Provider value={value}>
      {children}
      {mounted && <ZilAiDock />}
    </ZilAiContext.Provider>
  );
}

export function useZilAi(): ZilAiContextValue {
  const ctx = useContext(ZilAiContext);
  if (!ctx) throw new Error('useZilAi must be used inside <ZilAiProvider>');
  return ctx;
}

/** For components that may render outside the site layout (tests, isolated previews). */
export function useZilAiOptional(): ZilAiContextValue | null {
  return useContext(ZilAiContext);
}
