'use client';

import { useEffect } from 'react';
import { installAutoGrowTextareas } from '@/lib/autoGrowTextareas';

/** Mounted once in AppProviders: every textarea grows with its text up to 6 lines, then scrolls. */
export default function AutoGrowTextareas() {
  useEffect(() => installAutoGrowTextareas(), []);
  return null;
}
