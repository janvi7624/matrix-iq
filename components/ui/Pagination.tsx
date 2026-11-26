'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import CommonButton from './CommonButton';
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
      <CommonButton variant="secondary" size="sm" leadingIcon={<ChevronLeft />} disabled={page === 1} onClick={() => onChange(page - 1)}>Prev</CommonButton>
      <span className={calcStyles.small}>Page {page} of {totalPages}</span>
      <CommonButton variant="secondary" size="sm" trailingIcon={<ChevronRight />} disabled={page === totalPages} onClick={() => onChange(page + 1)}>Next</CommonButton>
    </div>
  );
}
