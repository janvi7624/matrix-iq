// Minimal shared CSV helpers — export side (escape/build) is used across
// several modules already; this adds a small RFC4180-ish parser for the
// Product Master import feature, which is the first place in the app that
// needs to read a CSV back in rather than only generate one.

// Excel/Sheets/LibreOffice treat a cell starting with = + - or @ as a formula
// when the file is opened, so exported text has to be neutralised with a
// leading apostrophe (the spreadsheet's own "this is literal text" marker).
// This is not hypothetical here: OCR'd company names in the leads table
// genuinely start with '=='. Numbers are passed through untouched — a
// negative amount is a number, not a formula, and quoting it would break
// every numeric column in every export.
// Phone numbers and negative amounts are the common false positives: almost
// every Indian mobile in this database is stored as "+91…", and a number that
// a caller has already turned into a string ("-500") reaches here as text, so
// a type check alone doesn't catch it. Both would be prefixed and land in the
// sheet as left-aligned text that SUM skips. Only a leading = or @, or a + / -
// that is NOT the start of a number, is actually a formula risk.
function neutralizeFormula(value: unknown, str: string): string {
  if (typeof value === 'number') return str;
  if (/^[=@]/.test(str)) return `'${str}`;
  if (/^[+\-]/.test(str) && !/^[+\-][\d\s(]/.test(str)) return `'${str}`;
  return str;
}

export function csvEscape(value: unknown): string {
  const str = neutralizeFormula(value, String(value ?? ''));
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const headerLine = headers.map(csvEscape).join(',');
  const bodyLines = rows.map((row) => row.map(csvEscape).join(','));
  return [headerLine, ...bodyLines].join('\r\n') + '\r\n';
}

// Handles quoted fields (with embedded commas/newlines/escaped quotes) and
// both \n and \r\n line endings. Returns rows of raw string cells — callers
// map header row -> object.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char === '\r') {
      // skip — \n (if present) handles the row break
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((key, i) => {
      obj[key.trim()] = (row[i] ?? '').trim();
    });
    return obj;
  });
}
