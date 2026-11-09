import { describe, it, expect } from 'vitest';
import { renderFestivalEmail } from '../../lib/email/templates/festival';

describe('renderFestivalEmail', () => {
  it('includes the recipient name, festival name, and greeting in both html and text', () => {
    const { subject, html, text } = renderFestivalEmail({ name: 'Asha', festivalName: 'Diwali', greeting: 'Happy Diwali! Wishing you joy.' });
    expect(subject).toContain('Diwali');
    expect(html).toContain('Asha');
    expect(html).toContain('Happy Diwali! Wishing you joy.');
    expect(text).toContain('Asha');
    expect(text).toContain('Happy Diwali! Wishing you joy.');
  });

  it('escapes HTML-significant characters in the greeting so a future data change cannot inject markup', () => {
    const { html } = renderFestivalEmail({ name: 'Asha', festivalName: 'Test', greeting: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
