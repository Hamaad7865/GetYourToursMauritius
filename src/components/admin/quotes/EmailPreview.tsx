'use client';

import { useMemo } from 'react';
import { Card } from '@/components/admin/ui';
import { renderQuoteEmail } from '@/lib/email/quote';
import {
  previewEmailInput,
  refusalMessage,
  type QuoteFormValues,
} from '@/components/admin/quotes/state';

/**
 * The guest's email, before it is sent.
 *
 * An email cannot be recalled, and this one carries a price, a guest's name and a link that takes a
 * card payment — so the cheapest guard available is letting the operator read it first. It is the
 * REAL renderer (`renderQuoteEmail`, the same function the send route calls), fed from the form on
 * screen through the same parser the save uses, so what is shown here is what would go out.
 *
 * It therefore also inherits the renderer's refusals: a total its lines do not support, or a quote
 * totalling nothing, throws instead of rendering — and that message is shown in place of the
 * preview, which is exactly the moment for the operator to see it.
 *
 * `sandbox=""` on the iframe: no scripts, no forms, no navigation, no access to this page. The HTML
 * being rendered is assembled from free text an operator typed (escaped by the renderer), and it is
 * shown inside the back office; a sandboxed frame means the preview can never be more than a
 * picture of an email.
 *
 * The LINK in it is a placeholder. The raw token is minted by the send route — the only writer of
 * `quotes.token_hash` — and lives in exactly two places afterwards: the guest's email and the send
 * response, which the Send pane shows with a copy button.
 */
export function EmailPreview({ form }: { form: QuoteFormValues }) {
  const rendered = useMemo(() => {
    try {
      return { email: renderQuoteEmail(previewEmailInput(form)), error: null as string | null };
    } catch (err) {
      return {
        email: null,
        error: refusalMessage(err, 'This quote cannot be previewed or sent as it stands.'),
      };
    }
  }, [form]);

  if (rendered.error) {
    return (
      <Card title="Preview">
        <p
          role="alert"
          className="rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium leading-relaxed text-coral"
        >
          {rendered.error}
        </p>
      </Card>
    );
  }

  const email = rendered.email!;
  return (
    <Card title="Preview">
      <p className="mb-2 text-[13px] text-ink">
        <span className="font-bold">Subject:</span> {email.subject}
      </p>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
        This is the email the guest receives. The link inside it is a placeholder — the real one is
        minted when you press Send, and shown here to copy.
      </p>
      <iframe
        title="Quote email preview"
        sandbox=""
        srcDoc={email.html}
        className="h-[540px] w-full rounded-xl border border-[#E2E7EA] bg-white"
      />
    </Card>
  );
}
