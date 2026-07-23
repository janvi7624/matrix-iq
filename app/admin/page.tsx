import QuotationHistoryView from '@/components/QuotationHistoryView';

export default function AdminPage() {
  return (
    <QuotationHistoryView
      title="NANTA Admin — Quotation History"
      subtitle="Every quotation generated from the Sales Quotation Estimator."
      showXlsxExport
    />
  );
}
