'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_WAIT_MS = 10_000;
const TOKEN_POLL_MS = 150;

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      size: 'flexible';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null; // let a later mount try again
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

export interface TurnstileHandle {
  /** The current token, waiting briefly for a challenge still running. Null when none arrives. */
  getToken(): Promise<string | null>;
  /** Tokens work once, so a failed attempt must get a fresh one. */
  reset(): void;
}

/**
 * Cloudflare Turnstile for the guest Pay button. Invisible unless Cloudflare wants an interaction, in
 * which case it appears here, right above the button that needs it. Loads only for guests, so account
 * holders never fetch a third-party script.
 */
export const TurnstileWidget = forwardRef<TurnstileHandle, { siteKey: string }>(
  function TurnstileWidget({ siteKey }, ref) {
    const elementRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    useEffect(() => {
      let active = true;
      loadScript()
        .then(() => {
          if (!active || !elementRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(elementRef.current, {
            sitekey: siteKey,
            appearance: 'interaction-only',
            size: 'flexible',
            callback: (token) => {
              tokenRef.current = token;
            },
            'expired-callback': () => {
              tokenRef.current = null;
            },
            'error-callback': () => {
              tokenRef.current = null;
            },
          });
        })
        .catch(() => {
          /* no token will arrive, and the server refuses the booking with a retryable message */
        });
      return () => {
        active = false;
        if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
        tokenRef.current = null;
      };
    }, [siteKey]);

    useImperativeHandle(
      ref,
      () => ({
        async getToken() {
          const deadline = Date.now() + TOKEN_WAIT_MS;
          while (!tokenRef.current && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS));
          }
          return tokenRef.current;
        },
        reset() {
          tokenRef.current = null;
          if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        },
      }),
      [],
    );

    return <div ref={elementRef} className="mt-4" />;
  },
);
