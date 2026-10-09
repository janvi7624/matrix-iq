import { describe, it, expect } from 'vitest';
import { isDriveLink, parseDriveLink } from '../../lib/driveLink';

describe('parseDriveLink', () => {
  it('accepts the link Drive’s Share dialog gives you', () => {
    expect(parseDriveLink('https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view?usp=sharing')).toEqual({
      id: '1SRXwd2o9wHwXxXPR7k',
      kind: 'file',
      url: 'https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view'
    });
  });

  it('accepts a folder link, and knows it is a folder', () => {
    // The real ALLBOTIX link shape, query string and all.
    const parsed = parseDriveLink('https://drive.google.com/drive/folders/1SRX-wd2o9wHwXxXPR7k_oTNJaQP75BVK?usp=drive_link');
    expect(parsed).toEqual({
      id: '1SRX-wd2o9wHwXxXPR7k_oTNJaQP75BVK',
      kind: 'folder',
      url: 'https://drive.google.com/drive/folders/1SRX-wd2o9wHwXxXPR7k_oTNJaQP75BVK'
    });
  });

  it('accepts a folder link with the account prefix the address bar adds', () => {
    expect(parseDriveLink('https://drive.google.com/drive/u/0/folders/1SRXwd2o9wHwXxXPR7k')?.kind).toBe('folder');
  });

  it('accepts Google-native document links', () => {
    for (const url of [
      'https://docs.google.com/document/d/1SRXwd2o9wHwXxXPR7k/edit',
      'https://docs.google.com/spreadsheets/d/1SRXwd2o9wHwXxXPR7k/edit#gid=0',
      'https://docs.google.com/presentation/d/1SRXwd2o9wHwXxXPR7k/edit'
    ]) {
      expect(parseDriveLink(url)?.id).toBe('1SRXwd2o9wHwXxXPR7k');
      expect(parseDriveLink(url)?.kind).toBe('file');
    }
  });

  it('accepts the older open?id= and uc?id= shapes', () => {
    expect(parseDriveLink('https://drive.google.com/open?id=1SRXwd2o9wHwXxXPR7k')?.id).toBe('1SRXwd2o9wHwXxXPR7k');
    expect(parseDriveLink('https://drive.google.com/uc?id=1SRXwd2o9wHwXxXPR7k&export=download')?.id).toBe('1SRXwd2o9wHwXxXPR7k');
  });

  it('normalises two shapes of the same file to one stored link', () => {
    // Two people pasting the same document mustn't produce two different
    // stored URLs, or the library shows it twice with different links.
    const a = parseDriveLink('https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view?usp=sharing');
    const b = parseDriveLink('https://drive.google.com/open?id=1SRXwd2o9wHwXxXPR7k');
    expect(a?.url).toBe(b?.url);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseDriveLink('  https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view  ')?.id).toBe('1SRXwd2o9wHwXxXPR7k');
  });

  it('rejects anything that is not a Google Drive URL', () => {
    // Storing one of these would produce an "Open" button leading somewhere
    // unexpected — worse than refusing it at the form.
    for (const url of [
      '',
      '   ',
      'not a url',
      'https://example.com/file/d/1SRXwd2o9wHwXxXPR7k/view',
      'https://dropbox.com/s/abc/file.pdf',
      'https://evil.com/?redirect=https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view'
    ]) {
      expect(parseDriveLink(url)).toBeNull();
    }
  });

  it('rejects a Drive URL with no id in it', () => {
    expect(parseDriveLink('https://drive.google.com/')).toBeNull();
    expect(parseDriveLink('https://drive.google.com/drive/my-drive')).toBeNull();
    // Too short to be a real Drive id — a typo, not a file.
    expect(parseDriveLink('https://drive.google.com/file/d/abc/view')).toBeNull();
  });
});

describe('isDriveLink', () => {
  it('agrees with the parser, so the form and the API can never disagree', () => {
    expect(isDriveLink('https://drive.google.com/drive/folders/1SRXwd2o9wHwXxXPR7k')).toBe(true);
    expect(isDriveLink('https://example.com/x')).toBe(false);
    expect(isDriveLink('')).toBe(false);
  });
});
