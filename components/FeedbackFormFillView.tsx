'use client';

import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import { ProductFeedbackFormRecord } from '@/lib/types';

interface FeedbackFormFillViewProps {
  formId: string;
}

export default function FeedbackFormFillView({ formId }: FeedbackFormFillViewProps) {
  const [form, setForm] = useState<ProductFeedbackFormRecord | null>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/feedback-forms/${formId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setForm)
      .catch(() => setError('This form could not be found, or no longer exists.'));
  }, [formId]);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/feedback-forms/${formId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not submit your response.');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  const content = error ? (
    <div className={historyStyles.loginError}>{error}</div>
  ) : !form ? (
    <SkeletonRows rows={4} />
  ) : submitted ? (
    <div className={historyStyles.status}>Thanks — your response has been recorded.</div>
  ) : form.status === 'closed' ? (
    <div className={historyStyles.status}>This form is closed and no longer accepting responses.</div>
  ) : (
    <>
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>{form.title}</h2>
      {form.description && <div className={historyStyles.status}>{form.description}</div>}
      <div className={historyStyles.status}>Asked by {form.pm_name}</div>
      <div className={calcStyles.sectionPanel}>
        {form.questions.map((q) => (
          <div key={q.id} className={calcStyles.field}>
            <label className={calcStyles.label}>{q.label}</label>
            {q.type === 'text' && (
              <textarea
                className={calcStyles.formControl}
                rows={2}
                value={(answers[q.id] as string) || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            )}
            {q.type === 'rating' && (
              <select
                className={calcStyles.formControl}
                value={(answers[q.id] as number) || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))}
              >
                <option value="">Select a rating...</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {q.type === 'choice' && (
              <select
                className={calcStyles.formControl}
                value={(answers[q.id] as string) || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              >
                <option value="">Select...</option>
                {(q.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}
          </div>
        ))}
        <button type="button" className={calcStyles.btn} disabled={submitting} onClick={handleSubmit}>
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </>
  );

  return <AppShell title="Feedback form" subtitle="Your answers go straight to the Product Manager who asked.">{content}</AppShell>;
}
