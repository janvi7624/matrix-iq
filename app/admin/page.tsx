import QuotationHistoryView from '@/components/QuotationHistoryView';
import { BRAND } from '@/lib/branding';

export default function AdminPage() {
  return (
    <QuotationHistoryView
      title={`${BRAND.appName} — Quotation History`}
      subtitle="Every quotation generated across the CRM."
      showXlsxExport
    />
  );
}
