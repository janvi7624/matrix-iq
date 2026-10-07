'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import QuotationCalculator, { CurrentUser } from './QuotationCalculator';
import MyQuotationsView from './MyQuotationsView';

const TABS = [
  { key: 'new' as const, label: 'New Quotation' },
  { key: 'existing' as const, label: 'Existing Quotations' }
];

interface QuotationsViewProps {
  currentUser: CurrentUser;
  canEditPricing: boolean;
  isPrivileged: boolean;
}

// Merges what used to be two separate Sales sidebar entries (New Quotation,
// Existing Quotations) into one — the builder (components/QuotationCalculator,
// 1000+ lines, a stateful multi-step wizard) stays completely untouched
// internally; this just tabs it alongside the existing quotations list. The
// "Revise" action on a past quotation still works unchanged — it navigates to
// /quotation?reviseId=..., which continues to resolve on its own.
export default function QuotationsView({ currentUser, canEditPricing, isPrivileged }: QuotationsViewProps) {
  const initialTab = useSearchParams().get('tab') === 'existing' ? 'existing' : 'new';
  const [tab, setTab] = useState<'new' | 'existing'>(initialTab);

  return (
    <AppShell title="Quotations" subtitle="Build a new quotation, or search and follow up on quotations you've already created.">
      <div className={historyStyles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${historyStyles.tabBtn} ${tab === t.key ? historyStyles.tabBtnActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'new' ? (
        <QuotationCalculator currentUser={currentUser} canEditPricing={canEditPricing} isPrivileged={isPrivileged} embedded />
      ) : (
        <MyQuotationsView embedded />
      )}
    </AppShell>
  );
}
