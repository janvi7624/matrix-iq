import { describe, it, expect } from 'vitest';
import {
  PARTNER_MARKETING_SUBMITTABLE_FIELDS,
  PARTNER_MARKETING_STAGE_ORDER,
  partnerMarketingActionRequired,
  partnerMarketingProgressPercent,
  resolvePartnerMarketingStage,
  toPartnerVisibleMarketingRequest
} from '../../lib/partnerMarketingVisibility';
import type { MarketingRequestRecord, MarketingRequestStatus } from '../../lib/types';

// The projection is the only thing standing between a partner and the
// internal marketing workspace. These tests assert field by field, because
// the failure mode is silent: an extra field in the payload leaks, it does
// not crash.

function record(overrides: Partial<MarketingRequestRecord> = {}): MarketingRequestRecord {
  return {
    id: 'mr-1',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: 'partner.user',
    creator_name: 'Partner User',
    partner_id: 'p-1',
    partner_company: 'Acme Distribution',
    partner_code: 'ACME',
    updated_at: '2026-10-05T10:00:00.000Z',
    project_id: 'proj-1',
    assigned_to: 'marketing.lead',
    assigned_to_id: 'u-2',
    assigned_to_name: 'Marketing Lead',
    technical_member_id: 'u-3',
    technical_member_username: 'tech.reviewer',
    technical_member_name: 'Tech Reviewer',
    title: 'Brochure for X200',
    product_category: 'Robotics',
    request_type: 'brochure_flyer',
    description: 'Need a two-page brochure.',
    additional_info: 'Hindi and English.',
    priority: 'high',
    needed_by_date: '2026-11-01',
    attachments: ['/uploads/partner/p-1/spec.pdf'],
    status: 'submitted',
    marketing_prepared_content: 'INTERNAL draft copy',
    marketing_attachments: ['/uploads/internal/draft.pdf'],
    marketing_remarks: 'INTERNAL remark',
    technical_instructions: 'INTERNAL instructions',
    technical_review_decision: 'approved',
    technical_remarks: 'INTERNAL technical remark',
    technical_reviewed_at: '2026-10-04T10:00:00.000Z',
    technical_reviewed_by: 'tech.reviewer',
    final_submission_notes: 'Here is your brochure.',
    final_submission_files: ['/uploads/final/brochure.pdf'],
    timeline: null,
    rejection_reason: '',
    completion_notes: 'INTERNAL completion note',
    delivered_files: [],
    assignment_status: 'accepted',
    assignment_decline_reason: '',
    comments: [],
    ...overrides
  } as MarketingRequestRecord;
}

describe('toPartnerVisibleMarketingRequest', () => {
  it('returns exactly the whitelisted keys and no others', () => {
    const view = toPartnerVisibleMarketingRequest(record());
    expect(Object.keys(view).sort()).toEqual([
      'action_required',
      'additional_info',
      'attachments',
      'created_at',
      'description',
      'final_files',
      'final_notes',
      'id',
      'needed_by_date',
      'priority',
      'product_category',
      'progress_percent',
      'project_id',
      'rejection_reason',
      'request_type',
      'stage',
      'stage_label',
      'title',
      'updated_at'
    ]);
  });

  it('never carries an internal workspace field or a staff identity', () => {
    const view = toPartnerVisibleMarketingRequest(record()) as unknown as Record<string, unknown>;
    const serialised = JSON.stringify(view);

    for (const leaked of [
      'marketing_prepared_content',
      'marketing_remarks',
      'technical_instructions',
      'technical_remarks',
      'technical_review_decision',
      'assignment_status',
      'assignment_decline_reason',
      'completion_notes',
      'assigned_to',
      'assigned_to_id',
      'assigned_to_name',
      'technical_member_id',
      'technical_member_username',
      'technical_member_name',
      'created_by',
      'creator_name'
    ]) {
      expect(view[leaked]).toBeUndefined();
    }

    // Belt and braces: the staff usernames must not appear anywhere in the
    // payload, including inside a value rather than as a key.
    expect(serialised).not.toContain('marketing.lead');
    expect(serialised).not.toContain('tech.reviewer');
    expect(serialised).not.toContain('INTERNAL');
  });

  it('never exposes the raw internal status string', () => {
    const view = toPartnerVisibleMarketingRequest(record({ status: 'pending_technical_review' }));
    expect(JSON.stringify(view)).not.toContain('pending_technical_review');
    expect(view.stage).toBe('in_review');
    expect(view.stage_label).toBe('In review');
  });

  it('withholds the deliverables until the request is actually completed', () => {
    // final_submission_* is a working draft right up to delivery. A partner
    // seeing it mid-flight reads it as the finished thing.
    const inFlight = toPartnerVisibleMarketingRequest(record({ status: 'marketing_final_review' }));
    expect(inFlight.final_notes).toBe('');
    expect(inFlight.final_files).toEqual([]);

    const done = toPartnerVisibleMarketingRequest(record({ status: 'completed' }));
    expect(done.final_notes).toBe('Here is your brochure.');
    expect(done.final_files).toEqual(['/uploads/final/brochure.pdf']);
  });

  it('shows a rejection reason only when the request is actually rejected', () => {
    const live = toPartnerVisibleMarketingRequest(record({ status: 'submitted', rejection_reason: 'stale text' }));
    expect(live.rejection_reason).toBe('');

    const rejected = toPartnerVisibleMarketingRequest(record({ status: 'rejected', rejection_reason: 'Out of scope.' }));
    expect(rejected.rejection_reason).toBe('Out of scope.');
  });

  it('echoes back everything the partner typed in', () => {
    const view = toPartnerVisibleMarketingRequest(record());
    expect(view.title).toBe('Brochure for X200');
    expect(view.description).toBe('Need a two-page brochure.');
    expect(view.additional_info).toBe('Hindi and English.');
    expect(view.priority).toBe('high');
    expect(view.needed_by_date).toBe('2026-11-01');
    expect(view.attachments).toEqual(['/uploads/partner/p-1/spec.pdf']);
  });
});

describe('resolvePartnerMarketingStage', () => {
  it('collapses every internal status onto a partner-facing stage', () => {
    const cases: [MarketingRequestStatus, string][] = [
      ['submitted', 'submitted'],
      ['approved', 'submitted'],
      ['timeline_set', 'submitted'],
      ['marketing_in_progress', 'in_progress'],
      ['in_progress', 'in_progress'],
      ['waiting_info', 'in_progress'],
      ['tech_changes_requested', 'in_progress'],
      ['pending_technical_review', 'in_review'],
      ['technical_approved', 'in_review'],
      ['marketing_final_review', 'in_review'],
      ['ready_for_review', 'in_review'],
      ['completed', 'completed'],
      ['rejected', 'rejected'],
      ['cancelled', 'rejected']
    ];
    for (const [status, expected] of cases) {
      expect(resolvePartnerMarketingStage(status)).toBe(expected);
    }
  });

  it('never leaks our internal handoffs as a partner-facing label', () => {
    // 'tech_changes_requested' means MARKETING must revise, not the partner.
    // Surfacing it would read as a problem on their side.
    expect(resolvePartnerMarketingStage('tech_changes_requested')).toBe('in_progress');
  });
});

describe('progress and action prompts', () => {
  it('advances monotonically through the ordered stages', () => {
    const percents = PARTNER_MARKETING_STAGE_ORDER.map(partnerMarketingProgressPercent);
    expect(percents).toEqual([25, 50, 75, 100]);
  });

  it('gives a rejected request no progress rather than a misleading bar', () => {
    expect(partnerMarketingProgressPercent('rejected')).toBe(0);
  });

  it('asks the partner for input only when Marketing is actually waiting on them', () => {
    expect(partnerMarketingActionRequired({ status: 'waiting_info' })).toBe(true);
    for (const status of ['submitted', 'marketing_in_progress', 'pending_technical_review', 'completed'] as MarketingRequestStatus[]) {
      expect(partnerMarketingActionRequired({ status })).toBe(false);
    }
  });
});

describe('the submittable allow-list', () => {
  it('lets a partner send only their own request content', () => {
    expect([...PARTNER_MARKETING_SUBMITTABLE_FIELDS].sort()).toEqual([
      'additionalInfo',
      'attachments',
      'description',
      'neededByDate',
      'priority',
      'productCategory',
      'projectId',
      'requestType',
      'title'
    ]);
  });

  it('accepts nothing that would let a partner set workflow or assignment', () => {
    const forbidden = ['status', 'assignedTo', 'assigned_to_id', 'technicalMemberId', 'partnerId', 'partner_id', 'createdBy'];
    for (const field of forbidden) {
      expect(PARTNER_MARKETING_SUBMITTABLE_FIELDS as readonly string[]).not.toContain(field);
    }
  });
});
