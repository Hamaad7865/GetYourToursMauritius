import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  EMPTY_ACTIVITY,
  createActivity,
  loadActivityForEdit,
  updateActivity,
  type ActivityFormValues,
} from '@/lib/admin/activity-write';
import type {
  AdminAssistantResponse,
  AssistantAction,
  AssistantMessage,
  AssistantPageContext,
  TourContentPatch,
} from '@/lib/validation/admin-assistant';

/**
 * The browser half of the assistant: one turn of chat, and the APPLY path that turns a proposal
 * into a real change.
 *
 * WHY APPLYING LIVES HERE AND NOT ON THE SERVER. The route's tools are read-only by construction,
 * so nothing the model says can write. A proposal only becomes a write when a human presses Apply,
 * and then it runs HERE — through `createActivity` / `updateActivity`, the same tested write path
 * the tour editor uses, with the operator's own authenticated session, so RLS applies as that
 * person and the change is attributable to them.
 *
 * `contentOnly: true` on every write is the money guardrail expressed in code: it skips
 * `assertPricingValid`, `reconcileOptions`, `reconcileSupplements` and `materializeActivity`, so an
 * assistant-applied change can never create, alter or destroy a price, an option or a departure.
 * Combined with `tourContentPatchSchema` (which has no price field at all) the assistant can write
 * words and nothing else.
 */

/** The signed-in staff session, or null. Never throws: it is read only for a bearer token. */
async function session(): Promise<{ accessToken: string } | null> {
  try {
    const { data } = await getBrowserSupabase().auth.getSession();
    return data.session ? { accessToken: data.session.access_token } : null;
  } catch {
    return null;
  }
}

/** One turn of the assistant. The route is stateless — the panel owns the conversation. */
export async function askAdminAssistant(
  messages: AssistantMessage[],
  page: AssistantPageContext | null,
): Promise<AdminAssistantResponse> {
  const staff = await session();
  const res = await fetch('/api/v1/admin/assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(staff ? { authorization: `Bearer ${staff.accessToken}` } : {}),
    },
    body: JSON.stringify({ messages, page }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: AdminAssistantResponse;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.ok || !body.data) {
    throw new Error(body?.error?.message ?? 'The assistant did not answer — try again.');
  }
  return body.data;
}

/** Slugify a title the way a human would, for a new draft tour. */
function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Fold a content patch onto a form. Only the keys the assistant actually sent are touched, so an
 * update that carries just `highlights` cannot blank a description; a list REPLACES rather than
 * appends, which is what "copy the highlights from X" has to mean.
 */
export function applyPatch(base: ActivityFormValues, patch: TourContentPatch): ActivityFormValues {
  const next: ActivityFormValues = { ...base };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.summary !== undefined) next.summary = patch.summary;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.location !== undefined) next.location = patch.location;
  if (patch.meetingPoint !== undefined) next.meetingPoint = patch.meetingPoint;
  if (patch.cancellationPolicy !== undefined) next.cancellationPolicy = patch.cancellationPolicy;
  if (patch.seoTitle !== undefined) next.seoTitle = patch.seoTitle;
  if (patch.seoDescription !== undefined) next.seoDescription = patch.seoDescription;
  if (patch.highlights !== undefined) next.highlights = [...patch.highlights];
  if (patch.inclusions !== undefined) next.inclusions = [...patch.inclusions];
  if (patch.exclusions !== undefined) next.exclusions = [...patch.exclusions];
  if (patch.whatToBring !== undefined) next.whatToBring = [...patch.whatToBring];
  if (patch.importantInfo !== undefined) next.importantInfo = [...patch.importantInfo];
  return next;
}

/** What an applied action did, for the panel to report and to route the operator onwards. */
export interface AppliedAction {
  message: string;
  /** Where to send the operator to finish the job (pricing, review) — null for nothing to open. */
  href: string | null;
}

/**
 * Execute an approved proposal. Throws on refusal (RLS, validation) so the panel can show the real
 * message — the same `refusalMessage` treatment the rest of admin gives a PostgREST error.
 */
export async function applyAssistantAction(action: AssistantAction): Promise<AppliedAction> {
  if (action.kind === 'create_tour') {
    const title = action.patch.title?.trim();
    if (!title) throw new Error('That draft has no title — ask the assistant to name the tour.');
    // A draft, never published: content now, pricing by a human. `sourceExtra` starts empty, which
    // is correct for a brand-new row (buildExtra preserves unmanaged keys of an existing one).
    const form = applyPatch(
      { ...EMPTY_ACTIVITY, slug: slugify(title), status: 'draft' },
      action.patch,
    );
    const id = await createActivity(form, { contentOnly: true });
    return {
      message: `Draft tour “${title}” created. Add pricing and publish it when you are happy.`,
      href: `/admin/activities/${id}`,
    };
  }

  if (action.kind === 'update_tour') {
    const current = await loadActivityForEdit(action.activityId);
    if (!current) throw new Error(`“${action.activityTitle}” no longer exists.`);
    await updateActivity(action.activityId, applyPatch(current, action.patch), {
      contentOnly: true,
    });
    return {
      message: `Updated “${action.activityTitle}”. Prices and publishing are untouched.`,
      href: `/admin/activities/${action.activityId}`,
    };
  }

  // draft_quote_from_email — handing off to the quotes screen, which owns the drafting pipeline
  // (the departures loader it needs is browser-only). The thread travels in sessionStorage rather
  // than the URL: it is a customer's email, and a query string would land in history and logs.
  sessionStorage.setItem(ASSISTANT_QUOTE_EMAIL_KEY, action.email);
  return {
    message: 'Opening a new quote with this enquiry — review and price the lines before sending.',
    href: '/admin/quotes?assistant=draft',
  };
}

/** Where a handed-off enquiry waits for the quotes screen to pick it up. */
export const ASSISTANT_QUOTE_EMAIL_KEY = 'bmt.assistant.quoteEmail';
