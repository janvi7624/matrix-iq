'use client';

import { useState, useEffect } from 'react';
import styles from '@/components/calculator.module.css';

interface Country {
  name: string;
  dialCode: string;
  flag: string;
}

// Shown when API hasn't loaded yet / fails
const FALLBACK_COUNTRIES: Country[] = [
  { name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
  { name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰' },
  { name: 'Nepal', dialCode: '+977', flag: '🇳🇵' },
  { name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
];

// Expected digit counts per dial code
const DIGIT_COUNT: Record<string, number> = {
  '+91': 10,
  '+1': 10,
  '+44': 10,
  '+61': 9,
  '+86': 11,
  '+49': 10,
  '+33': 9,
  '+971': 9,
  '+65': 8,
  '+60': 9,
  '+92': 10,
  '+880': 10,
  '+94': 9,
  '+977': 10,
  '+81': 10,
  '+82': 10,
  '+55': 11,
  '+27': 9,
  '+234': 10,
  '+20': 10,
  '+90': 10,
  '+966': 9,
  '+974': 8,
  '+968': 8,
  '+973': 8,
};

function expectedDigits(dialCode: string): number {
  return DIGIT_COUNT[dialCode] ?? 10;
}

function parseValue(value: string): { dialCode: string; number: string } {
  if (value?.startsWith('+')) {
    const spaceIdx = value.indexOf(' ');
    if (spaceIdx > 0) {
      return { dialCode: value.slice(0, spaceIdx), number: value.slice(spaceIdx + 1) };
    }
  }
  return { dialCode: '+91', number: value ?? '' };
}

// Module-level cache so the API is only called once per session
let cachedCountries: Country[] | null = null;

async function fetchCountries(): Promise<Country[]> {
  const res = await fetch('/api/countries');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export default function PhoneInput({ value, onChange, disabled, id, className }: PhoneInputProps) {
  const parsed = parseValue(value);
  const [dialCode, setDialCode] = useState(parsed.dialCode);
  const [number, setNumber] = useState(parsed.number);
  const [countries, setCountries] = useState<Country[]>(cachedCountries ?? FALLBACK_COUNTRIES);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cachedCountries) return;
    fetchCountries()
      .then((list) => {
        cachedCountries = list;
        setCountries(list);
      })
      .catch(() => {
        // keep fallback list
      });
  }, []);

  // Sync when value changes externally
  useEffect(() => {
    const p = parseValue(value);
    setDialCode(p.dialCode);
    setNumber(p.number);
  }, [value]);

  function validate(num: string, code: string) {
    if (!num) { setError(''); return; }
    const exp = expectedDigits(code);
    setError(num.length !== exp ? `Enter ${exp} digits for ${code}` : '');
  }

  function handleDialChange(code: string) {
    setDialCode(code);
    validate(number, code);
    onChange(number ? `${code} ${number}` : '');
  }

  function handleNumberChange(raw: string) {
    const digits = raw.replace(/\D/g, '');
    setNumber(digits);
    validate(digits, dialCode);
    onChange(digits ? `${dialCode} ${digits}` : '');
  }

  return (
    <div>
      <div className={`${styles.phoneInputRow} ${className ?? ''}`}>
        <select
          className={`${styles.formControl} ${styles.phoneDialSelect}`}
          value={dialCode}
          onChange={(e) => handleDialChange(e.target.value)}
          disabled={disabled}
          aria-label="Country dial code"
        >
          {countries.map((c) => (
            <option key={`${c.name}-${c.dialCode}`} value={c.dialCode}>
              {c.flag} {c.dialCode} — {c.name}
            </option>
          ))}
        </select>
        <input
          id={id}
          className={styles.formControl}
          type="tel"
          placeholder="Phone number"
          value={number}
          onChange={(e) => handleNumberChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      {error && <span className={styles.phoneError}>{error}</span>}
    </div>
  );
}