import { describe, it, expect } from 'vitest';
import { isCustomLink, parseCustomLink } from '../../lib/customLink';

// This parser is the whole of the boundary between a pasted string and an
// <a href> rendered for every employee — and, once a material is published,
// for external partner users. React 19 blocks javascript: hrefs by itself,
// but nothing else, and this app sets no Content-Security-Policy, so a scheme
// that slips through here reaches the DOM. Hence the size of the reject list.

describe('parseCustomLink', () => {
  it('accepts the addresses marketing actually paste', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'https://vimeo.com/76979871',
      'https://www.dropbox.com/s/abc123/X200-Datasheet.pdf?dl=0',
      'https://nantatech.sharepoint.com/:b:/s/Marketing/EXAMPLE?e=aBcDeF',
      'https://vendor.example.com/docs/X200/datasheet-v3.pdf'
    ]) {
      expect(parseCustomLink(url)).not.toBeNull();
    }
  });

  it('keeps the query string and the fragment', () => {
    // SharePoint and Google Docs deep-link to a page with a fragment, and a
    // Dropbox share needs its ?dl= — dropping either silently breaks the link.
    expect(parseCustomLink('https://example.com/catalogue?page=2&lang=hi#section-3')?.url).toBe(
      'https://example.com/catalogue?page=2&lang=hi#section-3'
    );
  });

  it('keeps an explicit port, which intranet vendor links use', () => {
    const parsed = parseCustomLink('https://intranet.example.com:8443/materials/x200.pdf');
    expect(parsed?.url).toBe('https://intranet.example.com:8443/materials/x200.pdf');
    expect(parsed?.host).toBe('intranet.example.com:8443');
  });

  it('accepts plain http, because vendor intranets still run on it', () => {
    // Rejecting http would lose legitimate links and teach people the field
    // is broken. The scheme is what matters here, not the transport.
    expect(parseCustomLink('http://vendor.example.com/x.pdf')?.url).toBe('http://vendor.example.com/x.pdf');
  });

  it('lower-cases the scheme and host but leaves the path alone', () => {
    // A path is case-sensitive on most servers; a host is not.
    expect(parseCustomLink('HTTPS://Example.COM/X200')?.url).toBe('https://example.com/X200');
  });

  it('stores one spelling of an international domain, however it was typed', () => {
    // Otherwise the same vendor page gets filed twice — once unicode, once
    // punycode — and the library shows two entries for one document.
    const unicode = parseCustomLink('https://müller-displays.de/produkte/x200');
    const punycode = parseCustomLink('https://xn--mller-displays-gsb.de/produkte/x200');
    expect(unicode?.url).toBe(punycode?.url);
    expect(unicode?.host).toBe('xn--mller-displays-gsb.de');
  });

  it('encodes a space rather than refusing the paste', () => {
    // Outlook and WhatsApp both hand people URLs with spaces in them.
    expect(parseCustomLink('https://example.com/docs/X200 Datasheet.pdf')?.url).toBe(
      'https://example.com/docs/X200%20Datasheet.pdf'
    );
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseCustomLink('   https://example.com/x.pdf   ')?.url).toBe('https://example.com/x.pdf');
  });

  it('refuses every scheme that is not http or https', () => {
    // An allow-list, not a blocklist: a blocklist of the schemes known to be
    // bad today loses to intent:, view-source: and whatever ships next.
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      '   javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///C:/Windows/win.ini',
      'file:///etc/passwd',
      'blob:https://example.com/uuid',
      'about:blank',
      'chrome://settings',
      'edge://settings',
      'intent://scan/#Intent;scheme=http;end',
      'ftp://files.example.com/x.pdf',
      'mailto:sales@example.com',
      'tel:+911234567890'
    ]) {
      expect(parseCustomLink(url)).toBeNull();
    }
  });

  it('refuses a protocol-relative address', () => {
    // '//evil.com' reads in the UI like an internal path, but resolves
    // against the page scheme and navigates off-site. React does nothing
    // about it, so this is the only place it gets caught.
    expect(parseCustomLink('//evil.com/x')).toBeNull();
  });

  it('refuses credentials embedded in the address', () => {
    // user:pass@host is both a leak in a library the whole company reads and
    // the standard way a hostile link is dressed up as a familiar one. The
    // host of the second URL here is evil.com, not drive.google.com — which
    // is why the parser reads url.host and never a substring of the input.
    expect(parseCustomLink('https://user:pass@example.com/x')).toBeNull();
    expect(parseCustomLink('https://drive.google.com@evil.com/x')).toBeNull();
  });

  it('refuses a link pointed back at this app’s own uploads', () => {
    // Otherwise the link mode becomes a way to attach any other feature's
    // file — an expense bill, a PO document — skipping the filesExist check
    // and the uploads/materials/ prefix guard that the upload path installs.
    expect(parseCustomLink('/api/uploads/file/uploads/materials/x.pdf')).toBeNull();
    expect(parseCustomLink('https://matrixiq.example.com/api/uploads/file/uploads/expenses/bill.pdf')).toBeNull();
  });

  it('refuses what is not an address at all', () => {
    for (const url of ['', '   ', 'not a url', 'https://', 'http://[', 'www.example.com', 'example.com/brochure.pdf']) {
      expect(parseCustomLink(url)).toBeNull();
    }
  });

  it('refuses a host dressed up with a direction override', () => {
    expect(parseCustomLink('https://exa\u202Emple.com/x')).toBeNull();
  });

  it('refuses a paste too long to be a real link', () => {
    // web_view_link is TEXT with no limit of its own, so without this a paste
    // could store megabytes on the row.
    expect(parseCustomLink(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });

  it('neutralises a smuggled newline or null byte instead of refusing it', () => {
    // The URL parser strips both, leaving an inert same-host path — so there
    // is nothing to refuse. Header injection is what these shapes are for,
    // and nothing server-side ever fetches this value; see the note in
    // lib/customLink.ts. Pinned because the safety here is the normalisation,
    // not a check, and a future rewrite could lose it without noticing.
    expect(parseCustomLink('https://example.com/x\nHost: evil.com')?.url).toBe('https://example.com/xHost:%20evil.com');
    expect(parseCustomLink('https://example.com/x\u0000')?.url).toBe('https://example.com/x');
  });

  it('is a fixed point, because editing a material re-resolves its stored link', () => {
    for (const url of [
      'https://example.com/docs/X200 Datasheet.pdf',
      'HTTPS://Example.COM/X200',
      'https://müller-displays.de/p',
      'https://allbotix.com'
    ]) {
      const once = parseCustomLink(url);
      expect(once).not.toBeNull();
      expect(parseCustomLink(once!.url)?.url).toBe(once!.url);
    }
  });
});

describe('isCustomLink', () => {
  it('agrees with the parser, so the form and the API can never disagree', () => {
    expect(isCustomLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isCustomLink('javascript:alert(1)')).toBe(false);
    expect(isCustomLink('//evil.com')).toBe(false);
    expect(isCustomLink('')).toBe(false);
  });
});
