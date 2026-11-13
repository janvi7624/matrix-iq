import { describe, it, expect } from 'vitest';
import { renderFestivalClientEmail, festivalPalette } from '../../lib/email/templates/festivalClient';
import { signUnsubscribe, verifyUnsubscribe, buildUnsubscribeUrl } from '../../lib/unsubscribeToken';

const base = {
  recipientName: 'Mr. Sharma',
  company: 'Acme',
  festivalName: 'Diwali',
  headline: 'Happy Diwali from NANTA',
  message: 'May this festival of lights bring prosperity.\n\nWarm wishes to your team.',
  bannerUrl: 'https://app.example.com/api/public/festival-banner/abc',
  logoUrl: 'https://app.example.com/NANTA.png',
  unsubscribeUrl: 'https://app.example.com/api/public/unsubscribe?e=a%40b.com&t=x'
};

describe('renderFestivalClientEmail', () => {
  it('greets the client by name and includes banner, paragraphs and unsubscribe link', () => {
    const { subject, html, text } = renderFestivalClientEmail(base);
    expect(subject).toContain('Happy Diwali from NANTA');
    expect(html).toContain('Dear Mr. Sharma,');
    expect(html).toContain(base.bannerUrl);
    expect(html).toContain('Unsubscribe from festival greetings');
    expect(html.match(/<p style="margin:0 0 14px/g)?.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('Dear Mr. Sharma,');
    expect(text).toContain(base.unsubscribeUrl);
  });

  it('falls back to a generic salutation and a coloured header with no banner', () => {
    const { html } = renderFestivalClientEmail({ ...base, recipientName: '', bannerUrl: '' });
    expect(html).toContain('Dear Valued Partner,');
    expect(html).toContain('Happy Diwali');
    expect(html).not.toContain('festival-banner');
  });

  it('escapes every user-controlled field', () => {
    const { html } = renderFestivalClientEmail({ ...base, recipientName: '<b>x</b>', headline: '<script>1</script>', message: '<img src=x onerror=1>' });
    expect(html).not.toContain('<script>1');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('picks a festival-specific palette', () => {
    expect(festivalPalette('Diwali 2027').emoji).toBe('🪔');
    expect(festivalPalette('Christmas').emoji).toBe('🎄');
    expect(festivalPalette('Some Other Day').emoji).toBe('🎉');
  });
});

describe('unsubscribe tokens', () => {
  const key = 'test-secret';
  it('verifies a token only for the address it was issued to', () => {
    const token = signUnsubscribe('Client@Acme.com', key);
    expect(verifyUnsubscribe('client@acme.com', token, key)).toBe(true);
    expect(verifyUnsubscribe('other@acme.com', token, key)).toBe(false);
    expect(verifyUnsubscribe('client@acme.com', token + 'x', key)).toBe(false);
  });
  it('fails closed with no secret', () => {
    expect(signUnsubscribe('a@b.com', '')).toBe('');
    expect(verifyUnsubscribe('a@b.com', 'anything', '')).toBe(false);
  });
  it('builds no link without an app URL', () => {
    expect(buildUnsubscribeUrl('', 'a@b.com')).toBe('');
  });
});
