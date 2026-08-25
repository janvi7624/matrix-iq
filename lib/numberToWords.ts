const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

function chunk(n: number): string {
  if (n === 0) return '';
  if (n < 100) return twoDigit(n);
  const h = ONES[Math.floor(n / 100)];
  const rest = twoDigit(n % 100);
  return rest ? `${h} Hundred ${rest}` : `${h} Hundred`;
}

export function numberToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  if (num < 0) return `Minus ${numberToIndianWords(-num)}`;

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let r = rupees;
  const parts: string[] = [];

  const crore = Math.floor(r / 10000000);
  r %= 10000000;
  const lakh = Math.floor(r / 100000);
  r %= 100000;
  const thousand = Math.floor(r / 1000);
  r %= 1000;
  const remainder = r;

  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (remainder) parts.push(chunk(remainder));

  let result = `Rupees ${parts.join(' ')}`;
  if (paise > 0) result += ` and ${twoDigit(paise)} Paise`;
  result += ' Only';
  return result;
}
