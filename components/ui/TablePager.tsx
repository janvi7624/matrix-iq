'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Dropdown from './Dropdown';
import styles from './tablePager.module.css';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
/** 0 = show all rows. */
export type PageSize = number;

/** Page numbers to show, with 'gap' markers: 1 … 4 5 [6] 7 8 … 20. Pure — exported for tests. */
export function pageWindow(page: number, totalPages: number, around = 1): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  const start = Math.max(2, page - around);
  const end = Math.min(totalPages - 1, page + around);
  if (start > 2) out.push('gap');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < totalPages - 1) out.push('gap');
  out.push(totalPages);
  return out;
}

/**
 * Client-side paging for a list that is already in memory.
 *   const pager = usePagination(rows);
 *   pager.rows → the current page;  <TablePager {...pager.props} />
 * The page resets to 1 whenever the row count changes (a filter applied).
 */
export function usePagination<T>(rows: T[], defaultPageSize: PageSize = 25) {
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [page, setPage] = useState(1);
  const [lastTotal, setLastTotal] = useState(rows.length);

  // Filtering changes the total → back to page 1 (adjusting state during render, React's recommended pattern).
  let currentPage = page;
  if (lastTotal !== rows.length) {
    setLastTotal(rows.length);
    setPage(1);
    currentPage = 1;
  }

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = useMemo(
    () => (pageSize === 0 ? rows : rows.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [rows, pageSize, safePage]
  );

  return {
    rows: pageRows,
    props: {
      page: safePage,
      pageSize,
      total: rows.length,
      onPageChange: setPage,
      onPageSizeChange: (size: PageSize) => {
        setPageSize(size);
        setPage(1);
      }
    }
  };
}

export interface TablePagerProps {
  page: number;
  pageSize: PageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  /** e.g. "expenses" → "Showing 1–25 of 142 expenses". */
  noun?: string;
  sizes?: readonly number[];
  /** Offer "All" in the rows-per-page list (off for server-paged lists). Default true. */
  allowAll?: boolean;
}

/** Footer under a table: how many rows there are, rows per page, and page navigation. */
export default function TablePager({ page, pageSize, total, onPageChange, onPageSizeChange, noun = 'rows', sizes = PAGE_SIZE_OPTIONS, allowAll = true }: TablePagerProps) {
  if (total === 0) return null;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const from = pageSize === 0 ? 1 : (page - 1) * pageSize + 1;
  const to = pageSize === 0 ? total : Math.min(total, page * pageSize);

  return (
    <nav className={styles.footer} aria-label="Table pagination">
      <div className={styles.summary} aria-live="polite">
        Showing <strong>{from}–{to}</strong> of <strong>{total}</strong> {noun}
      </div>
      <div className={styles.controls}>
        <div className={styles.size}>
          <span aria-hidden="true">Rows per page</span>
          <Dropdown
            size="sm"
            ariaLabel="Rows per page"
            clearable={false}
            searchable={false}
            className={styles.select}
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            options={[
              ...sizes.map((s) => ({ value: String(s), label: String(s) })),
              ...(allowAll ? [{ value: '0', label: 'All' }] : [])
            ]}
          />
        </div>
        {totalPages > 1 && (
          <div className={styles.pages}>
            <button type="button" className={styles.page} onClick={() => onPageChange(1)} disabled={page === 1} aria-label="First page" title="First page">
              <ChevronsLeft />
            </button>
            <button type="button" className={styles.page} onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page" title="Previous page">
              <ChevronLeft />
            </button>
            {pageWindow(page, totalPages).map((p, i) =>
              p === 'gap' ? (
                <span key={`gap-${i}`} className={`${styles.gap} ${styles.pageNumber}`} aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={[styles.page, p === page ? styles.current : styles.pageNumber].join(' ')}
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                >
                  {p}
                </button>
              )
            )}
            <button type="button" className={styles.page} onClick={() => onPageChange(page + 1)} disabled={page === totalPages} aria-label="Next page" title="Next page">
              <ChevronRight />
            </button>
            <button type="button" className={styles.page} onClick={() => onPageChange(totalPages)} disabled={page === totalPages} aria-label="Last page" title="Last page">
              <ChevronsRight />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
