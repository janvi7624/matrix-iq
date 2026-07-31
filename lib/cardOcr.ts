// Client-side business-card OCR for the Lead Capture module. Runs entirely
// in the browser via Tesseract.js — no server round-trip and no API key,
// consistent with this app having no existing AI/vision backend. Field
// extraction from the raw OCR text is heuristic (regex + keyword matching):
// it gets common cases right but is not a full name-entity parser, which is
// why every field it fills stays editable in the wizard — same "read then
// let the user correct" flow as the original tool.

export interface ParsedCardFields {
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  rawText: string;
}

const DESIGNATION_KEYWORDS = [
  'manager', 'director', 'head', 'engineer', 'executive', 'president', 'ceo', 'cto', 'coo', 'cfo',
  'founder', 'owner', 'proprietor', 'officer', 'consultant', 'lead', 'specialist', 'supervisor',
  'sales', 'purchase', 'procurement', 'operations', 'technical', 'chairman', 'partner', 'vp'
];

const COMPANY_KEYWORDS = ['pvt', 'ltd', 'llp', 'inc', 'corp', 'company', 'industries', 'technologies', 'enterprises', 'group', 'solutions', 'systems', 'engineering', 'traders', 'exports', 'imports'];

const KNOWN_CITIES = [
  'ahmedabad', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'pune', 'surat', 'rajkot', 'vadodara', 'baroda',
  'chennai', 'hyderabad', 'kolkata', 'jaipur', 'indore', 'nagpur', 'lucknow', 'kanpur', 'gandhinagar',
  'noida', 'gurgaon', 'gurugram', 'chandigarh', 'coimbatore', 'vizag', 'visakhapatnam', 'bhopal', 'nashik'
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[-\s]?)?[6-9]\d{9}\b/;

// Downscale + grayscale + contrast-boost before OCR — meaningfully improves
// Tesseract's accuracy on photographed (as opposed to scanned) cards, and
// keeps the image small so recognition stays fast on a phone.
export async function preprocessCardImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;
        const contrast = 1.25;
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
          data[i] = data[i + 1] = data[i + 2] = adjusted;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function parseCardText(rawText: string): ParsedCardFields {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const email = rawText.match(EMAIL_RE)?.[0] || '';
  const mobileMatch = rawText.match(PHONE_RE)?.[0] || '';
  const mobile = mobileMatch.replace(/[^\d+]/g, '');

  const usedLines = new Set<string>();
  if (email) lines.forEach((l) => l.includes(email) && usedLines.add(l));
  if (mobileMatch) lines.forEach((l) => l.includes(mobileMatch) && usedLines.add(l));

  const designationLine = lines.find((l) => !usedLines.has(l) && DESIGNATION_KEYWORDS.some((k) => l.toLowerCase().includes(k)));
  if (designationLine) usedLines.add(designationLine);

  const companyLine = lines.find((l) => !usedLines.has(l) && COMPANY_KEYWORDS.some((k) => l.toLowerCase().includes(k)));
  if (companyLine) usedLines.add(companyLine);

  const cityLine = lines.find((l) => KNOWN_CITIES.some((c) => l.toLowerCase().includes(c)));
  const city = cityLine ? (KNOWN_CITIES.find((c) => cityLine.toLowerCase().includes(c)) as string).replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  if (cityLine) usedLines.add(cityLine);

  // Best-effort "name" pick: first remaining short-ish line that looks like
  // a person's name (2-4 capitalized words, no digits).
  const nameLine = lines.find((l) => !usedLines.has(l) && /^[A-Z][a-zA-Z.'-]*(\s+[A-Z][a-zA-Z.'-]*){1,3}$/.test(l) && !/\d/.test(l));

  return {
    name: nameLine || '',
    mobile,
    email,
    designation: designationLine || '',
    company: companyLine || '',
    city,
    rawText
  };
}

export async function scanBusinessCard(dataUrl: string, onProgress?: (pct: number) => void): Promise<ParsedCardFields> {
  const Tesseract = await import('tesseract.js');
  const result = await Tesseract.recognize(dataUrl, 'eng', {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
    }
  });
  return parseCardText(result.data.text);
}
