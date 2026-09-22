import { describe, it, expect } from 'vitest';
import { renderLeadHandoverEmail, LeadHandoverEmailData } from '../../lib/email/templates/leadHandover';

function data(overrides: Partial<LeadHandoverEmailData> = {}): LeadHandoverEmailData {
  return {
    name: 'Manali Akabari',
    capturedBy: 'Yashvi Panchal',
    capturedAt: '22 Sept 2026, 4:30 pm',
    contactName: 'Rahul Mehta',
    designation: 'Purchase Head',
    company: 'ABC Hospital',
    mobile: '+91 98250 12345',
    contactEmail: 'rahul@abchospital.in',
    city: 'Ahmedabad',
    priority: 'Hot — needs now',
    interests: ['Robotics'],
    subInterests: ['Reception Robot'],
    followUpActions: ['Schedule demo'],
    budget: '',
    notes: '',
    hasCardImage: true,
    leadsUrl: 'https://matrix-iq.nantatech.com/leads?filter=assigned-to-me',
    ...overrides
  };
}

describe('renderLeadHandoverEmail', () => {
  it('names the contact and company in the subject and who handed it over in the body', () => {
    const { subject, text } = renderLeadHandoverEmail(data());
    expect(subject).toBe('Lead handed over to you — Rahul Mehta, ABC Hospital');
    expect(text).toContain('Hello Manali Akabari,');
    expect(text).toContain('Yashvi Panchal captured a lead that belongs to you');
  });

  it('carries the contact details needed to call back straight from the email', () => {
    const { text } = renderLeadHandoverEmail(data());
    expect(text).toContain('Mobile: +91 98250 12345');
    expect(text).toContain('Email: rahul@abchospital.in');
    expect(text).toContain('Interested in: Robotics');
    expect(text).toContain('Business card: Photo attached to the lead in the app');
  });

  it('leaves out fields that were not filled in rather than printing blanks', () => {
    const { text } = renderLeadHandoverEmail(data({ budget: '', notes: '', city: '' }));
    expect(text).not.toMatch(/^Budget:/m);
    expect(text).not.toMatch(/^Notes:/m);
    expect(text).not.toMatch(/^City:/m);
  });

  it('falls back to the company alone when no contact name was captured', () => {
    expect(renderLeadHandoverEmail(data({ contactName: '' })).subject).toBe('Lead handed over to you — ABC Hospital');
  });

  it('links to the recipient\'s "Assigned to me" leads', () => {
    const { html, text } = renderLeadHandoverEmail(data());
    expect(html).toContain('href="https://matrix-iq.nantatech.com/leads?filter=assigned-to-me"');
    expect(text).toContain('Open your leads: https://matrix-iq.nantatech.com/leads?filter=assigned-to-me');
  });

  it('escapes captured text, which comes from OCR and free typing', () => {
    const { html } = renderLeadHandoverEmail(data({ notes: '<script>alert(1)</script>', company: 'A & B "Traders"' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &quot;Traders&quot;');
  });
});
