'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileText, Upload, XCircle } from 'lucide-react';
import {
  OnboardingProgress,
  PARTNER_DOCUMENT_HINT,
  PARTNER_DOCUMENT_LABEL,
  PartnerDocumentKind,
  onboardingHeadline
} from '@/lib/partnerOnboarding';
import PartnerShell from './PartnerShell';
import { useToast } from './ui/ToastProvider';
import Textarea from './ui/Textarea';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

// What a new partner sees instead of the portal: the three documents they
// owe, the state of each, and why one came back.
//
// Every other portal page redirects here until all three are approved
// (lib/partnerPageGuard.ts), so this screen has to be self-explanatory with
// no navigation to fall back on — hence the named account manager and the
// per-document reason rather than a generic "pending approval".

interface DocumentRecord {
  kind: PartnerDocumentKind;
  files: { name: string; path: string }[];
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_by_name: string;
  review_remarks: string;
}

interface Payload {
  documents: DocumentRecord[];
  progress: OnboardingProgress;
  complete: boolean;
  accountManagerName: string;
}

const STATE_ICON = {
  approved: <CheckCircle2 size={16} />,
  pending: <Clock size={16} />,
  rejected: <XCircle size={16} />,
  not_started: <FileText size={16} />
} as const;

const STATE_LABEL = {
  approved: 'Approved',
  pending: 'Awaiting review',
  rejected: 'Needs replacing',
  not_started: 'Not uploaded'
} as const;

function formatWhen(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function PartnerOnboardingView({
  companyName,
  partnerCode,
  alreadyOnboarded
}: {
  companyName: string;
  partnerCode: string;
  alreadyOnboarded: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [uploading, setUploading] = useState<PartnerDocumentKind | null>(null);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/partner/onboarding');
      if (!res.ok) { setFailed('Could not load your onboarding status.'); return; }
      setData(await res.json());
      setFailed('');
    } catch {
      setFailed('Could not reach the server.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function uploadFor(kind: PartnerDocumentKind, files: FileList | null) {
    if (!files?.length) return;
    setUploading(kind);
    try {
      // Two steps on purpose: /api/uploads stores the file under this
      // partner's own prefix (lib/partnerUploads.ts), then the onboarding
      // route records the resulting paths against the document. The second
      // call re-checks the prefix, so a stored path cannot be swapped for
      // another partner's.
      const fd = new FormData();
      fd.append('folder', 'partner-onboarding');
      for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
      const uploaded = await fetch('/api/uploads', { method: 'POST', body: fd });
      const uploadBody = await uploaded.json().catch(() => null);
      if (!uploaded.ok) { toast.error(uploadBody?.error || 'Upload failed.'); return; }

      const paths: string[] = uploadBody?.urls || [];
      const res = await fetch('/api/partner/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          files: paths.map((path, i) => ({ path, name: files[i]?.name || 'document' }))
        })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { toast.error(body?.error || 'Could not submit that document.'); return; }
      await load();
      toast.success(`${PARTNER_DOCUMENT_LABEL[kind]} sent for review.`);
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setUploading(null);
    }
  }

  const subtitle = alreadyOnboarded
    ? 'Your onboarding documents, as we hold them.'
    : 'Three documents are needed before your account is fully activated.';

  return (
    <PartnerShell title="Onboarding" subtitle={subtitle} partnerName={companyName} partnerCode={partnerCode}>
      {failed && <div className={historyStyles.loginError}>{failed}</div>}

      {!data ? (
        <div className={calcStyles.sectionPanel}><p className={calcStyles.small}>Loading…</p></div>
      ) : (
        <>
          <div className={calcStyles.sectionPanel}>
            <div className={calcStyles.h2}>{onboardingHeadline(data.progress)}</div>
            <p className={calcStyles.small}>
              {data.complete
                ? 'You have full access to the portal. You can still replace a document here if it is renewed or expires — doing so does not affect your access.'
                : 'Until all three are approved you can sign in, but the rest of the portal stays closed.'}
              {data.accountManagerName && ` Your account manager is ${data.accountManagerName}.`}
            </p>
          </div>

          {data.progress.steps.map((step) => {
            const doc = data.documents.find((d) => d.kind === step.kind);
            const busy = uploading === step.kind;
            return (
              <div key={step.kind} className={`${calcStyles.sectionPanel} ${styles.onboardingCard}`}>
                <div className={styles.onboardingHead}>
                  <span className={styles.onboardingTitle}>{step.label}</span>
                  <span className={`${styles.onboardingState} ${styles[`onboardingState_${step.state}`]}`}>
                    {STATE_ICON[step.state]} {STATE_LABEL[step.state]}
                  </span>
                </div>

                <p className={calcStyles.small}>{PARTNER_DOCUMENT_HINT[step.kind]}</p>

                {/* A rejection without its reason would have them re-sending
                    the same file. */}
                {step.state === 'rejected' && step.remarks && (
                  <div className={styles.onboardingRejection}>
                    <strong>Not accepted:</strong> {step.remarks}
                    {doc?.reviewed_by_name && <> — {doc.reviewed_by_name}</>}
                  </div>
                )}

                {step.state === 'approved' && doc?.reviewed_by_name && (
                  <p className={calcStyles.small}>Approved by {doc.reviewed_by_name}.</p>
                )}

                {doc && doc.files.length > 0 && (
                  <ul className={styles.onboardingFiles}>
                    {doc.files.map((f) => (
                      <li key={f.path}>
                        <a href={`/api/uploads/file/${f.path}`} target="_blank" rel="noopener noreferrer">{f.name}</a>
                      </li>
                    ))}
                    {doc.submitted_at && <li className={calcStyles.small}>Uploaded {formatWhen(doc.submitted_at)}</li>}
                  </ul>
                )}

                <label className={styles.onboardingUpload}>
                  <Upload size={15} />
                  {busy ? 'Uploading…' : step.state === 'not_started' ? 'Upload document' : 'Replace document'}
                  <input
                    type="file"
                    multiple
                    hidden
                    disabled={busy}
                    onChange={(e) => uploadFor(step.kind, e.target.files)}
                  />
                </label>
              </div>
            );
          })}
        </>
      )}
    </PartnerShell>
  );
}
