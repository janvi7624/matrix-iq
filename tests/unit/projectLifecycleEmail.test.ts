import { describe, it, expect } from 'vitest';
import { renderProjectLifecycleEmail } from '../../lib/email/templates/projectLifecycle';

const base = { name: 'Manali Akabari', projectLabel: 'Pinnacle therapeutics', projectUrl: 'https://matrix-iq.nantatech.com/projects/p1' };

describe('renderProjectLifecycleEmail — technical-person approval', () => {
  it('asks for approval, says nothing is assigned yet, and links to the request', () => {
    const { subject, html, text } = renderProjectLifecycleEmail({ ...base, event: 'technical_requested', detail: 'Requested: Manali Akabari (AI)\nNeeded on site by: 24 Sept 2026' });
    expect(subject).toBe('Approval Needed — Technical Person Request — Pinnacle therapeutics');
    expect(text).toContain('Nothing is assigned until this is approved');
    expect(html).toContain('>Review Request<');
    expect(html).toContain('href="https://matrix-iq.nantatech.com/projects/p1"');
  });

  it('renders each detail line as its own paragraph', () => {
    const { html } = renderProjectLifecycleEmail({ ...base, event: 'technical_requested', detail: 'Requested: A\nRequested by: B\nNote: <b>x</b>' });
    expect(html).toContain('>Requested: A</p>');
    expect(html).toContain('>Requested by: B</p>');
    expect(html).toContain('Note: &lt;b&gt;x&lt;/b&gt;');
  });

  it('tells the requester about approval and decline', () => {
    expect(renderProjectLifecycleEmail({ ...base, event: 'technical_approved' }).subject).toBe('Technical Person Approved — Pinnacle therapeutics');
    const declined = renderProjectLifecycleEmail({ ...base, event: 'technical_declined', detail: 'Reason: on another site' });
    expect(declined.text).toContain('was declined. Nobody has been assigned.');
    expect(declined.text).toContain('Reason: on another site');
  });

  it('keeps the existing events and their "View Project" button unchanged', () => {
    const { subject, html } = renderProjectLifecycleEmail({ ...base, event: 'assigned' });
    expect(subject).toBe('A Project Was Assigned to You — Pinnacle therapeutics');
    expect(html).toContain('>View Project<');
  });
});
