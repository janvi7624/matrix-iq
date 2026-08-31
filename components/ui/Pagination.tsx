'use client';

import historyStyles from '../quotationHistory.module.css';
import calcStyles from '../calculator.module.css';
import controlsStyles from './controls.module.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className={controlsStyles.pagination}>
      <button type="button" className={historyStyles.button} disabled={page === 1} onClick={() => onChange(page - 1)}>← Prev</button>
      <span className={calcStyles.small}>Page {page} of {totalPages}</span>
      <button type="button" className={historyStyles.button} disabled={page === totalPages} onClick={() => onChange(page + 1)}>Next →</button>
    </div>
  );
}
