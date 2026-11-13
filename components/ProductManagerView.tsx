'use client';

import { Fragment, FormEvent, useEffect, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import { ProductFeedbackFormRecord, ProductFeedbackQuestion, ProductFeedbackQuestionType, ProductFeedbackResponseRecord, ProductManagerNoteRecord, ProductManagerNoteType, ProductManagerRollup, ProductRecord } from '@/lib/types';

interface MyData {
  rollup: ProductManagerRollup | null;
  products: ProductRecord[];
  notes: ProductManagerNoteRecord[];
}

const NOTE_LABEL: Record<ProductManagerNoteType, string> = { feedback: 'Feedback received', action: 'Action taken', plan: 'Next plan' };

function newQuestionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const BLANK_QUESTION = (): ProductFeedbackQuestion => ({ id: newQuestionId(), label: '', type: 'text' });

function money(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function ProductManagerView() {
  const [data, setData] = useState<MyData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [noteType, setNoteType] = useState<ProductManagerNoteType>('feedback');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const [forms, setForms] = useState<ProductFeedbackFormRecord[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [questions, setQuestions] = useState<ProductFeedbackQuestion[]>([BLANK_QUESTION()]);
  const [suggestFor, setSuggestFor] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestSource, setSuggestSource] = useState<'ai' | 'rules' | null>(null);
  const [creatingForm, setCreatingForm] = useState(false);
  const [openResponsesFor, setOpenResponsesFor] = useState<string | null>(null);
  const [responses, setResponses] = useState<ProductFeedbackResponseRecord[]>([]);

  async function load() {
    try {
      const response = await fetch('/api/product-manager');
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setLoadError('Could not load your products.');
    }
  }

  async function loadForms() {
    try {
      const response = await fetch('/api/product-manager/feedback-forms');
      if (response.ok) setForms(await response.json());
    } catch {
      // Non-fatal — the rest of the page still works without it.
    }
  }

  useEffect(() => {
    load();
    loadForms();
  }, []);

  function updateQuestion(id: string, patch: Partial<ProductFeedbackQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function removeQuestion(id: string) {
    setQuestions((qs) => qs.filter((q) => q.id !== id));
  }

  async function applySuggestions() {
    const product = data?.products.find((p) => p.id === suggestFor);
    setSuggesting(true);
    setSuggestSource(null);
    try {
      const response = await fetch('/api/product-manager/feedback-forms/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: product?.name || '',
          category: product?.category || '',
          pendingValue: data?.rollup?.pending_value || 0,
          wonValue: data?.rollup?.won_value || 0,
          lostValue: data?.rollup?.lost_value || 0
        })
      });
      if (!response.ok) return;
      const { questions: suggestions, source } = await response.json();
      setSuggestSource(source);
      const existingLabels = new Set(questions.map((q) => q.label.trim().toLowerCase()));
      const fresh = (suggestions as ProductFeedbackQuestion[])
        .filter((s) => !existingLabels.has(s.label.trim().toLowerCase()))
        .map((s) => ({ ...s, id: newQuestionId() }));
      setQuestions((qs) => {
        const blankRemoved = qs.filter((q) => q.label.trim());
        return [...blankRemoved, ...fresh];
      });
      if (product) setFormTitle((t) => t || `${product.name} — feedback from the team`);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleCreateForm(e: FormEvent) {
    e.preventDefault();
    const cleanQuestions = questions.filter((q) => q.label.trim());
    if (!formTitle.trim() || !cleanQuestions.length) return;
    setCreatingForm(true);
    try {
      const response = await fetch('/api/product-manager/feedback-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: formTitle.trim(), description: formDescription.trim(), questions: cleanQuestions })
      });
      if (response.ok) {
        setFormTitle('');
        setFormDescription('');
        setQuestions([BLANK_QUESTION()]);
        setShowBuilder(false);
        await loadForms();
      }
    } finally {
      setCreatingForm(false);
    }
  }

  async function toggleFormStatus(form: ProductFeedbackFormRecord) {
    await fetch(`/api/product-manager/feedback-forms/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: form.status === 'open' ? 'closed' : 'open' })
    });
    await loadForms();
  }

  async function deleteForm(form: ProductFeedbackFormRecord) {
    await fetch(`/api/product-manager/feedback-forms/${form.id}`, { method: 'DELETE' });
    if (openResponsesFor === form.id) setOpenResponsesFor(null);
    await loadForms();
  }

  async function viewResponses(form: ProductFeedbackFormRecord) {
    if (openResponsesFor === form.id) {
      setOpenResponsesFor(null);
      return;
    }
    const response = await fetch(`/api/product-manager/feedback-forms/${form.id}`);
    setResponses(response.ok ? await response.json() : []);
    setOpenResponsesFor(form.id);
  }

  function formLink(id: string): string {
    return typeof window !== 'undefined' ? `${window.location.origin}/feedback-forms/${id}` : `/feedback-forms/${id}`;
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/product-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: noteType, text: noteText.trim() })
      });
      if (response.ok) {
        setNoteText('');
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const content = !data ? (
    loadError ? <div className={historyStyles.loginError}>{loadError}</div> : <SkeletonRows rows={4} />
  ) : (
    <>
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>My Products</h2>
      {data.products.length === 0 ? (
        <div className={historyStyles.status}>You haven&apos;t created any products yet — products are added from the Product Master screen (Admin), and whoever creates one becomes its Product Manager.</div>
      ) : (
        <>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.sectionPanel}><strong>Pending</strong><div>₹{money(data.rollup?.pending_value || 0)}</div></div>
            <div className={calcStyles.sectionPanel}><strong>Won</strong><div>₹{money(data.rollup?.won_value || 0)}</div></div>
            <div className={calcStyles.sectionPanel}><strong>Lost</strong><div>₹{money(data.rollup?.lost_value || 0)}</div></div>
          </div>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Name</th><th>SKU</th><th>Category</th><th>Type</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className={historyStyles.num}>{p.sku || '-'}</td>
                    <td>{p.category || '-'}</td>
                    <td>{p.type}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className={calcStyles.h2}>Feedback &amp; Plan</h2>
      <form className={calcStyles.sectionPanel} onSubmit={handleAddNote}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Type</label>
            <select className={calcStyles.formControl} value={noteType} onChange={(e) => setNoteType(e.target.value as ProductManagerNoteType)}>
              <option value="feedback">Feedback received</option>
              <option value="action">Action taken</option>
              <option value="plan">Next plan</option>
            </select>
          </div>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Notes</label>
          <textarea className={calcStyles.formControl} value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} required />
        </div>
        <button type="submit" className={calcStyles.btn} disabled={saving}>{saving ? 'Saving...' : '+ Add Entry'}</button>
      </form>

      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead><tr><th>Type</th><th>Note</th><th>By</th><th>Date</th></tr></thead>
          <tbody>
            {data.notes.map((n) => (
              <tr key={n.id}>
                <td>{NOTE_LABEL[n.type]}</td>
                <td>{n.text}</td>
                <td>{n.created_by || '-'}</td>
                <td>{n.created_at ? new Date(n.created_at).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
            {data.notes.length === 0 && <tr><td colSpan={4}>No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className={calcStyles.h2}>Feedback Forms</h2>
      <div className={historyStyles.status}>Ask the internal team for feedback on your product — build a quick form, share the link, and see every answer collected here.</div>
      <div className={calcStyles.sectionPanel}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowBuilder((v) => !v)}>
          {showBuilder ? 'Cancel' : '+ Create Feedback Form'}
        </button>

        {showBuilder && (
          <form className={calcStyles.sectionPanel} onSubmit={handleCreateForm}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Form title</label>
              <input className={calcStyles.formControl} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="e.g. LED Display — feedback from sales team" required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Description (optional)</label>
              <input className={calcStyles.formControl} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
            </div>

            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Suggest questions for which product?</label>
                <select className={calcStyles.formControl} value={suggestFor} onChange={(e) => setSuggestFor(e.target.value)}>
                  <option value="">Select a product...</option>
                  {(data?.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button type="button" className={historyStyles.button} disabled={!suggestFor || suggesting} onClick={applySuggestions}>
                {suggesting ? 'Thinking...' : '✨ Suggest Questions'}
              </button>
            </div>
            {suggestSource && (
              <div className={historyStyles.status}>
                {suggestSource === 'ai' ? 'Suggested by AI based on this product and its usage data.' : 'Suggested from the built-in question bank (AI suggestions unavailable right now).'}
              </div>
            )}

            {questions.map((q, i) => (
              <div key={q.id} className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Question {i + 1}</label>
                  <input className={calcStyles.formControl} value={q.label} onChange={(e) => updateQuestion(q.id, { label: e.target.value })} placeholder="e.g. Is the pricing competitive?" />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Answer type</label>
                  <select className={calcStyles.formControl} value={q.type} onChange={(e) => updateQuestion(q.id, { type: e.target.value as ProductFeedbackQuestionType })}>
                    <option value="text">Text</option>
                    <option value="rating">Rating (1-5)</option>
                    <option value="choice">Multiple choice</option>
                  </select>
                </div>
                {q.type === 'choice' && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Options (comma separated)</label>
                    <input
                      className={calcStyles.formControl}
                      value={(q.options || []).join(', ')}
                      onChange={(e) => updateQuestion(q.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                    />
                  </div>
                )}
                <button type="button" className={historyStyles.deleteBtn} onClick={() => removeQuestion(q.id)}>Remove</button>
              </div>
            ))}
            <button type="button" className={historyStyles.button} onClick={() => setQuestions((qs) => [...qs, BLANK_QUESTION()])}>+ Add Question</button>
            <div>
              <button type="submit" className={calcStyles.btn} disabled={creatingForm}>{creatingForm ? 'Creating...' : 'Create Form'}</button>
            </div>
          </form>
        )}
      </div>

      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead><tr><th>Title</th><th>Status</th><th>Responses</th><th>Link to share</th><th></th></tr></thead>
          <tbody>
            {forms.map((f) => (
              <Fragment key={f.id}>
                <tr>
                  <td>{f.title}</td>
                  <td>{f.status === 'open' ? 'Open' : 'Closed'}</td>
                  <td>{f.response_count}</td>
                  <td><input className={calcStyles.formControl} readOnly value={formLink(f.id)} onFocus={(e) => e.target.select()} /></td>
                  <td>
                    <div className={historyStyles.rowActionsInline}>
                      <button type="button" className={historyStyles.button} onClick={() => viewResponses(f)}>{openResponsesFor === f.id ? 'Hide' : 'View'} responses</button>
                      <button type="button" className={historyStyles.button} onClick={() => toggleFormStatus(f)}>{f.status === 'open' ? 'Close' : 'Reopen'}</button>
                      <button type="button" className={historyStyles.deleteBtn} onClick={() => deleteForm(f)}>Delete</button>
                    </div>
                  </td>
                </tr>
                {openResponsesFor === f.id && (
                  <tr>
                    <td colSpan={5}>
                      {responses.length === 0 ? (
                        <div className={historyStyles.status}>No responses yet.</div>
                      ) : (
                        <table className={historyStyles.table}>
                          <thead><tr><th>From</th><th>Answers</th><th>Submitted</th></tr></thead>
                          <tbody>
                            {responses.map((r) => (
                              <tr key={r.id}>
                                <td>{r.respondent_name || 'Unknown'}</td>
                                <td>
                                  {f.questions.map((q) => (
                                    <div key={q.id}><strong>{q.label}:</strong> {r.answers[q.id] ?? '-'}</div>
                                  ))}
                                </td>
                                <td>{new Date(r.submitted_at).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {forms.length === 0 && <tr><td colSpan={5}>No feedback forms yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <AppShell title="My Products" subtitle="Products you created, their Pending/Won/Lost value, and your feedback/action/plan log">
      {content}
    </AppShell>
  );
}
