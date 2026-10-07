'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import ProductMasterView from './ProductMasterView';
import ProductCatalogView from './ProductCatalogView';

const TABS = [
  { key: 'master' as const, label: 'Product Master' },
  { key: 'catalog' as const, label: 'Product Catalog' }
];

// Merges what used to be two separate Administration sidebar entries
// (Product Master, Product Catalog) into one — they manage unrelated data
// (free-form CRUD products feeding the quotation "Custom Products" picker,
// vs. price/name overrides on 11 hardcoded AV/Robotics/AI/VisitIQ catalogs),
// so neither view's internals changed; this just tabs them together.
export default function ProductsAdminView() {
  const initialTab = useSearchParams().get('tab') === 'catalog' ? 'catalog' : 'master';
  const [tab, setTab] = useState<'master' | 'catalog'>(initialTab);

  return (
    <AppShell title="Products" subtitle="Administration › products available in quotations, and price/name overrides on the built-in AV, Robotics, AI Analytics & VisitIQ catalogs.">
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
      {tab === 'master' ? <ProductMasterView embedded /> : <ProductCatalogView embedded />}
    </AppShell>
  );
}
