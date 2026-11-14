'use client';

import { useState, type ReactNode } from 'react';
import { BTN_GHOST, INPUT_CLS, buttonClass } from '@/components/admin/ui';
import { whatsappHref, whatsappNumber } from '@/components/admin/quotes/whatsapp';

/**
 * The link a send has just returned, with a Copy button and — when the guest's phone carries a
 * country code — a WhatsApp link with the message already typed.
 *
 * The `url` comes straight from the send (or balance) response and is held only in the caller's
 * state: never stored, logged or rebuilt. It is the raw token's only home on our side, which is why
 * this panel says so.
 *
 * WhatsApp opens from a real link the operator clicks, never `window.open` after the send's await:
 * a popup blocker would swallow that, and a link also works on a phone, where wa.me hands over to the
 * app.
 */
export function FreshLink({
  url,
  heading,
  inputLabel,
  phone,
  message,
  note,
}: {
  url: string;
  heading: string;
  /** The read-only field's accessible name. */
  inputLabel: string;
  phone: string | null;
  /** The WhatsApp message, carrying `url`. */
  message: string;
  note?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const number = whatsappNumber(phone);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is in a selectable field beside the button.
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-ground px-3.5 py-3">
      <p className="mb-2 text-[12.5px] font-bold text-ink">{heading}</p>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          aria-label={inputLabel}
          onFocus={(e) => e.currentTarget.select()}
          className={`${INPUT_CLS} min-w-0 flex-1 basis-56 font-mono text-[12px]`}
        />
        <button type="button" onClick={() => void copy()} className={BTN_GHOST}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <div className="mt-2.5">
        {'digits' in number ? (
          <a
            href={whatsappHref(number.digits, message)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('ghost', 'sm')}
          >
            Open WhatsApp with the message ready
            <span className="sr-only"> (opens WhatsApp in a new tab)</span>
          </a>
        ) : (
          <p className="text-[12px] text-ink-soft">{number.reason}</p>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
        {note ??
          'Shown once, here. Only a fingerprint of it is stored, so if you lose it, send again: the guest gets a new link and this one stops working.'}
      </p>
    </div>
  );
}
