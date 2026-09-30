import { describe, it, expect } from 'vitest';
import { checkProjectCompleteness } from '../../lib/projectCompleteness';

const LEAD = 'a18ec31a-6a3d-4d14-862d-25c4fd4e7ff9';
const complete = { approx_price: 100000, expected_closing_date: '2026-10-01', remarks: 'Some notes', project_lead_id: LEAD, opportunity_type: 'project' };

describe('checkProjectCompleteness', () => {
  it('is complete when price, closing date, remarks, project lead and opportunity type are all present', () => {
    expect(checkProjectCompleteness(complete)).toEqual({ isComplete: true, missingFields: [] });
  });

  it('flags a missing approx_price', () => {
    const result = checkProjectCompleteness({ ...complete, approx_price: '' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('approx_price');
  });

  it('flags a missing expected_closing_date', () => {
    expect(checkProjectCompleteness({ ...complete, expected_closing_date: '' }).missingFields).toContain('expected_closing_date');
  });

  it('flags remarks that are blank or only whitespace', () => {
    expect(checkProjectCompleteness({ ...complete, remarks: '' }).missingFields).toContain('remarks');
    expect(checkProjectCompleteness({ ...complete, remarks: '   ' }).missingFields).toContain('remarks');
  });

  it('flags a missing project lead — mandatory on every project', () => {
    const result = checkProjectCompleteness({ ...complete, project_lead_id: '' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual(['project_lead_id']);
  });

  it('flags a missing opportunity type — mandatory on every project', () => {
    const result = checkProjectCompleteness({ ...complete, opportunity_type: '' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual(['opportunity_type']);
  });

  it('lists every missing field at once when nothing has been filled in', () => {
    const result = checkProjectCompleteness({ approx_price: '', expected_closing_date: '', remarks: '', project_lead_id: '', opportunity_type: '' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual(['approx_price', 'expected_closing_date', 'remarks', 'project_lead_id', 'opportunity_type']);
  });

  // Department is an optional field — the great majority of projects predate
  // it, so a blank one must NOT make a project read as incomplete.
  it('never flags a missing department — the field is optional', () => {
    expect(checkProjectCompleteness(complete)).toEqual({ isComplete: true, missingFields: [] });
  });
});
