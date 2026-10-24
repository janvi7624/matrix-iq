import { describe, it, expect } from 'vitest';
import { projectLabel, projectLabelWithClient } from '../../lib/projectLabel';

// Regression guard for a real confusion: a technical person was notified
// that "sales requested you for Test-Task" about a project called
// "MeetIQ - Reliance" — because every copy of this helper answered with the
// CLIENT's name and ignored project_name. The request looked like it had
// never arrived.

describe('projectLabel', () => {
  it('prefers the project’s own name', () => {
    expect(projectLabel({ project_name: 'MeetIQ - Reliance', client_name: 'Test-Task', company: 'Testing Project' }))
      .toBe('MeetIQ - Reliance');
  });

  it('falls back to the client, then the company, for older projects', () => {
    // project_name was added later, so the overwhelming majority of rows
    // have none — they must read exactly as they did before.
    expect(projectLabel({ project_name: '', client_name: 'Ravi Kumar', company: 'Acme' })).toBe('Ravi Kumar');
    expect(projectLabel({ project_name: '', client_name: '', company: 'Acme' })).toBe('Acme');
  });

  it('never returns an empty string', () => {
    expect(projectLabel({})).toBe('Project');
    expect(projectLabel({ project_name: '', client_name: '', company: '' })).toBe('Project');
    expect(projectLabel(null)).toBe('Project');
    expect(projectLabel(undefined)).toBe('Project');
  });

  it('accepts a partially-selected row', () => {
    // Several callers select only a couple of columns.
    expect(projectLabel({ company: 'Acme' })).toBe('Acme');
  });
});

describe('projectLabelWithClient', () => {
  it('names the project and who it is for', () => {
    expect(projectLabelWithClient({ project_name: 'MeetIQ - Reliance', client_name: 'Test-Task', company: '' }))
      .toBe('MeetIQ - Reliance (Test-Task)');
  });

  it('does not repeat itself when both fields hold the same text', () => {
    expect(projectLabelWithClient({ project_name: 'Acme', client_name: 'Acme', company: '' })).toBe('Acme');
  });

  it('degrades to the plain label when there is no client', () => {
    expect(projectLabelWithClient({ project_name: 'MeetIQ', client_name: '', company: '' })).toBe('MeetIQ');
  });
});
