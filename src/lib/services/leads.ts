import type { ServiceContext } from './context';
import { NotImplementedError } from './errors';

export type LeadStatus = 'new' | 'contacted' | 'converted';

export interface CaptureLeadInput {
  name: string;
  /** Email or phone — how to reach the lead. */
  contact: string;
  interestTourId?: string | null;
  source?: string;
}

export interface Lead {
  id: string;
  name: string;
  contact: string;
  interestTourId: string | null;
  status: LeadStatus;
  source: string;
  createdAt: string;
}

export async function captureLead(_ctx: ServiceContext, _input: CaptureLeadInput): Promise<Lead> {
  // Phase 5: insert into `leads` (also reachable from the AI assistant).
  throw new NotImplementedError('captureLead');
}
