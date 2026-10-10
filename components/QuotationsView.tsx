'use client';

import { useRouter, useSearchParams } from 'next/navigation';
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
// internally; this just tabs it alongside the existing quotations list.
//
// The tab is read from the URL on every render rather than held in
// useState, and that is load-bearing, not a style choice.
//
// "Revise" on a past quotation links to /quotation?reviseId=… — and that
// button is rendered by QuotationTable inside THIS page's own "Existing
// Quotations" tab. Navigating /quotation -> /quotation is the same route,
// so Next client-navigates without remounting: a useState tab initialised
// once stayed on 'existing', the calculator never rendered, and pressing
// Revise did nothing at all. It only ever worked from the separate
// /my-quotations route, where the navigation really was a route change.
//
// Deriving from the URL means there is no stale state to desync, and the
// current tab is linkable and survives a refresh.
export default function QuotationsView({ currentUser, canEditPricing, isPrivileged }: QuotationsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Revising always means the builder, whatever ?tab says — the link that
  // starts a revision carries no tab of its own.
  const tab: 'new' | 'existing' = searchParams.get('reviseId')
    ? 'new'
    : searchParams.get('tab') === 'existing'
      ? 'existing'
      : 'new';

  function selectTab(next: 'new' | 'existing') {
    // replace, not push: flipping a tab shouldn't fill the back button with
    // history. scroll:false keeps the viewport where it was.
    router.replace(next === 'existing' ? '/quotation?tab=existing' : '/quotation', { scroll: false });
  }

  return (
    <AppShell title="Quotations" subtitle="Build a new quotation, or search and follow up on quotations you've already created.">
      <div className={historyStyles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${historyStyles.tabBtn} ${tab === t.key ? historyStyles.tabBtnActive : ''}`}
            onClick={() => selectTab(t.key)}
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
