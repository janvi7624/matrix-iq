import QuotationHistoryView from '@/components/QuotationHistoryView';
import { BRAND } from '@/lib/branding';

export default function QuotationHistoryPage() {
  return (
    <QuotationHistoryView
      title={`${BRAND.appName} — Quotation History`}
      subtitle="Every quotation generated across the CRM, with a guaranteed-unique quotation number."
    />
  );
}
