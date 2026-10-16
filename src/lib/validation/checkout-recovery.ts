import { z } from 'zod';

/** POST /api/v1/checkout-reminders/opt-out — the token from the recovery email's "stop" link. */
export const checkoutRecoveryOptOutSchema = z.object({
  token: z.string().min(16).max(128),
});
export type CheckoutRecoveryOptOutInput = z.infer<typeof checkoutRecoveryOptOutSchema>;
