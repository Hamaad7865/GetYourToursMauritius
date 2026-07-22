import { describe, expect, it } from 'vitest';
import { renderReviewRequestEmail } from '@/lib/email/review-request';

const GOOGLE_URL = 'https://g.page/r/test-review-link/review';

describe('renderReviewRequestEmail', () => {
  it('includes both buttons, worded identically regardless of any known rating', () => {
    const email = renderReviewRequestEmail({
      customerName: 'Alex Guest',
      activityTitle: 'Dolphin Swim',
      siteReviewUrl: 'https://bellemaretours.com/reviews/write?token=abc123',
      googleReviewUrl: GOOGLE_URL,
    });
    expect(email.subject).toContain('Dolphin Swim');
    expect(email.html).toContain('Review us on our site');
    expect(email.html).toContain('Review us on Google');
    expect(email.html).toContain('https://bellemaretours.com/reviews/write?token=abc123');
    expect(email.html).toContain(GOOGLE_URL);
    expect(email.text).toContain(GOOGLE_URL);
  });

  it('escapes a hostile activity title so it cannot break out of the HTML', () => {
    const email = renderReviewRequestEmail({
      customerName: 'X',
      activityTitle: '<script>alert(1)</script>',
      siteReviewUrl: 'https://bellemaretours.com/reviews/write?token=x',
      googleReviewUrl: GOOGLE_URL,
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
