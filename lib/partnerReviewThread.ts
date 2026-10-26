// The back-and-forth between Sales and a partner over a submitted project,
// assembled into ONE ordered conversation that both sides read.
//
// Why this exists: the exchange was already being recorded, but in two
// different tables and read by only one of the two audiences. Sales'
// decisions land in project_timeline_events; the partner's replies land in
// project_notes. The portal merged them into an activity feed, so the
// partner could follow along — but the internal reviewer's panel showed
// neither, which meant the person being asked to decide could not see what
// had already been asked or what had come back. A second information request
// was written blind.
//
// `projects.partner_review_remarks` is NOT the record. It holds only the
// MOST RECENT remark and is overwritten on every round, so round one's
// question is destroyed by round two. It stays as the banner text; the
// thread below is the history.
//
// Pure (no Sequelize, no React) so both the server and either client can use
// it, and so the ordering and direction rules are directly testable.

/** Which side of the conversation an entry came from. */
export type ReviewSide = 'internal' | 'partner';

/**
 * The timeline label written when a partner first submits.
 *
 * Exported so lib/partnerProjectStore.ts writes it from here rather than
 * from a literal. Direction below is derived from these labels, so a label
 * edited in one place and not the other would silently attribute Sales'
 * decisions to the partner.
 */
export const PARTNER_SUBMISSION_EVENT_LABEL = 'Submitted by partner';

/** The timeline label written for each review decision. */
export const PARTNER_REVIEW_EVENT_LABEL: Record<'approved' | 'rejected' | 'info_requested', string> = {
  approved: 'Accepted by sales',
  rejected: 'Not taken forward',
  info_requested: 'More information requested'
};

const INTERNAL_EVENT_LABELS = new Set<string>(Object.values(PARTNER_REVIEW_EVENT_LABEL));

/**
 * The shape both sides already have.
 *
 * Internally these are ProjectTimelineEvent / ProjectNote; in the portal they
 * are the projected PartnerVisibleTimelineEvent. Declared structurally so
 * neither side has to convert, and so this module imports no types that
 * would drag the ORM in.
 */
export interface ReviewThreadSource {
  at: string;
  label: string;
  remarks: string;
}

export interface ReviewThreadEntry {
  at: string;
  side: ReviewSide;
  /** Short heading — "Information requested", "Partner replied". */
  title: string;
  /** What was actually written. May be empty for a decision with no remark. */
  body: string;
}

const TITLE_BY_LABEL: Record<string, string> = {
  [PARTNER_SUBMISSION_EVENT_LABEL]: 'Submitted',
  [PARTNER_REVIEW_EVENT_LABEL.approved]: 'Accepted',
  [PARTNER_REVIEW_EVENT_LABEL.rejected]: 'Declined',
  [PARTNER_REVIEW_EVENT_LABEL.info_requested]: 'Information requested'
};

/**
 * Who wrote a given timeline event.
 *
 * Derived from the label rather than from the author's username, because the
 * partner-facing projection deliberately strips `by` (which internal person
 * acted is staffing information — see lib/partnerVisibility.ts). The three
 * review labels are the only ones Sales writes; everything else
 * partner-visible originates with the partner.
 */
export function sideOfEvent(label: string): ReviewSide {
  return INTERNAL_EVENT_LABELS.has(label) ? 'internal' : 'partner';
}

/**
 * Build the conversation.
 *
 * Notes are the partner's own words — their description at submission and
 * their answers to information requests — which is why they are attributed
 * to the partner without inspecting the label. Both of the only two writers
 * of a partner-visible note (lib/partnerProjectStore.ts) are partner
 * actions; should an internal partner-visible note ever be added, it must
 * pass its side explicitly rather than fall through to this default.
 *
 * Ordered oldest first: a conversation reads forwards, and the caller that
 * wants newest-first reverses it.
 */
export function buildPartnerReviewThread(input: {
  timeline: ReviewThreadSource[];
  notes: ReviewThreadSource[];
}): ReviewThreadEntry[] {
  const fromEvents: ReviewThreadEntry[] = input.timeline.map((event) => {
    const side = sideOfEvent(event.label);
    return {
      at: event.at,
      side,
      title: TITLE_BY_LABEL[event.label] ?? event.label,
      body: event.remarks ?? ''
    };
  });

  const fromNotes: ReviewThreadEntry[] = input.notes.map((note) => ({
    at: note.at,
    side: 'partner' as const,
    title: 'Partner replied',
    body: note.remarks ?? ''
  }));

  return [...fromEvents, ...fromNotes].sort((a, b) => {
    if (a.at === b.at) {
      // Same timestamp happens because a decision and its note are written
      // in one transaction. The decision is what prompted the reply, so it
      // reads first.
      if (a.side === b.side) return 0;
      return a.side === 'internal' ? -1 : 1;
    }
    return a.at < b.at ? -1 : 1;
  });
}

/**
 * The most recent thing Sales asked for, or '' if they have not asked.
 *
 * Used for the "what are we waiting on" banner. Reads the thread rather than
 * partner_review_remarks so it stays correct after an approval or decline
 * has overwritten that column.
 */
export function latestInformationRequest(thread: ReviewThreadEntry[]): string {
  for (let i = thread.length - 1; i >= 0; i--) {
    const entry = thread[i];
    if (entry.side === 'internal' && entry.title === 'Information requested') return entry.body;
  }
  return '';
}

/**
 * How many times Sales has gone back for more. Shown so a reviewer opening a
 * resubmitted project can see at a glance that this is not the first round.
 */
export function informationRequestCount(thread: ReviewThreadEntry[]): number {
  return thread.filter((entry) => entry.side === 'internal' && entry.title === 'Information requested').length;
}

/**
 * Whose move it is, from the submission status alone.
 *
 * 'partner' while an information request is outstanding, 'internal' while a
 * submission waits on a decision, and null once the submission is settled —
 * at which point the project is an ordinary one and nobody owes a reply.
 */
export function awaitingSide(submissionStatus: string): ReviewSide | null {
  if (submissionStatus === 'info_requested') return 'partner';
  if (submissionStatus === 'submitted') return 'internal';
  return null;
}
