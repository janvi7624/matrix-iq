'use client';

import { useState } from 'react';
import { Check, Clock, Eye, FileText, Upload, X } from 'lucide-react';
import { PartnerRecord } from '@/lib/types';
import { PARTNER_DOCUMENT_GROUPS, PARTNER_DOCUMENT_KINDS, PARTNER_DOCUMENT_LABEL } from '@/lib/partnerOnboarding';
import {
  PARTNER_APPROVAL_LABEL,
  PARTNER_APPROVAL_STAGES,
  PartnerApprovalStage,
  PartnerApprovalTrailEntry,
  approvalStatusLine,
  currentRoundDecisions,
  lastRejection
} from '@/lib/partnerApprovalChain';
import Modal, { ModalCancelButton } from './ui/Modal';
import styles from './partnerApproval.module.css';

export interface ApprovalInfo {
  stage: PartnerApprovalStage | 'approved' | null;
  trail: PartnerApprovalTrailEntry[];
  approvers: Record<PartnerApprovalStage, { id: string; username: string; name: string }[]>;
  canDecide: boolean;
}

interface DocRow {
  kind: (typeof PARTNER_DOCUMENT_KINDS)[number];
  files: { name: string; path: string }[];
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  review_remarks: string;
}

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// A stored path is either a bare storage key (partner's own upload) or an
// already-built /api/uploads/file/... URL (staff upload) — normalise both.
const fileHref = (path: string) => (path.startsWith('/api/') ? path : `/api/uploads/file/${path}`);

// Onboarding approval for one partner: the three-step Sales → Accounts →
// Admin chain as a stepper, the documents with View buttons, and — for the
// approver whose step it is — Approve / Send back.
export default function PartnerApprovalPanel({
  partner,
  documents,
  approval,
  canManage,
  uploading,
  deciding,
  onUpload,
  onDecide
}: {
  partner: PartnerRecord;
  documents: DocRow[];
  approval: ApprovalInfo | null;
  canManage: boolean;
  uploading: string | null;
  deciding: boolean;
  onUpload: (kind: string, files: FileList | null) => void;
  onDecide: (decision: 'approved' | 'rejected', remarks: string, rejectKinds: string[]) => Promise<boolean>;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectKinds, setRejectKinds] = useState<string[]>([]);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('');

  const stage = approval?.stage ?? (partner.onboarded_at ? 'approved' : null);
  const trail = approval?.trail ?? [];
  const done = currentRoundDecisions(trail);
  const rejection = lastRejection(trail);
  const activeIndex = stage && stage !== 'approved' ? PARTNER_APPROVAL_STAGES.indexOf(stage) : -1;

  return (
    <>
      <h2 className={styles.heading}>Onboarding approval</h2>
      <div className={styles.panel}>
        <div className={`${styles.banner} ${stage === 'approved' ? styles.bannerDone : rejection && !stage ? styles.bannerRejected : styles.bannerPending}`}>
          {stage === 'approved'
            ? partner.onboarded_at
              ? `Fully approved on ${new Date(partner.onboarded_at).toLocaleDateString('en-IN')} — this partner can start work.`
              : approvalStatusLine('approved')
            : rejection && !stage
              ? `Sent back by ${rejection.by_name} (${PARTNER_APPROVAL_LABEL[rejection.stage]}): “${rejection.remarks}” — waiting for the partner to replace the documents.`
              : `${approvalStatusLine(stage)} The partner can only start work once all three managers approve.`}
        </div>

        <ol className={styles.stepper}>
          {PARTNER_APPROVAL_STAGES.map((s, i) => {
            const decision = done[s];
            const isDone = stage === 'approved' || !!decision;
            const isActive = i === activeIndex;
            const people = approval?.approvers[s] ?? [];
            return (
              <li key={s} className={`${styles.step} ${isDone ? styles.stepDone : isActive ? styles.stepActive : ''}`}>
                <span className={styles.stepDot}>{isDone ? <Check size={14} /> : isActive ? <Clock size={14} /> : i + 1}</span>
                <div className={styles.stepBody}>
                  <div className={styles.stepTitle}>{PARTNER_APPROVAL_LABEL[s]}</div>
                  <div className={styles.stepWho}>{people.length ? people.map((p) => p.name || p.username).join(', ') : 'No manager set in Department Master'}</div>
                  <div className={styles.stepState}>
                    {decision
                      ? `Approved by ${decision.by_name} · ${fmt(decision.at)}`
                      : isDone
                        ? 'Approved'
                        : isActive
                          ? 'Awaiting decision'
                          : 'Not started'}
                  </div>
                  {decision?.remarks && <div className={styles.stepNote}>“{decision.remarks}”</div>}
                </div>
              </li>
            );
          })}
        </ol>

        {PARTNER_DOCUMENT_GROUPS.map((group) => (
        <div key={group.title} className={styles.docGroup}>
        <div className={styles.docGroupTitle}>{group.title}</div>
        <div className={styles.docList}>
          {group.kinds.map((kind) => {
            const doc = documents.find((d) => d.kind === kind);
            return (
              <div key={kind} className={styles.docRow}>
                <span className={styles.docIcon}><FileText size={18} /></span>
                <div className={styles.docMain}>
                  <div className={styles.docTitle}>{PARTNER_DOCUMENT_LABEL[kind]}</div>
                  <div className={styles.docMeta}>
                    {!doc ? (
                      'Not uploaded yet'
                    ) : (
                      <>
                        <span className={`${styles.pill} ${doc.status === 'approved' ? styles.pillOk : doc.status === 'rejected' ? styles.pillBad : styles.pillWait}`}>
                          {doc.status === 'approved' ? 'Approved' : doc.status === 'rejected' ? 'Needs replacing' : 'Uploaded'}
                        </span>
                        {doc.submitted_at && <span>Uploaded {fmt(doc.submitted_at)}</span>}
                        {doc.status === 'rejected' && doc.review_remarks && <span className={styles.docReject}>“{doc.review_remarks}”</span>}
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.docActions}>
                  {doc?.files.map((f, i) => (
                    <a key={f.path} className={styles.viewBtn} href={fileHref(f.path)} target="_blank" rel="noopener noreferrer" title={f.name}>
                      <Eye size={14} /> View{doc.files.length > 1 ? ` ${i + 1}` : ''}
                    </a>
                  ))}
                  {canManage && stage !== 'approved' && (
                    <label className={styles.uploadBtn}>
                      <Upload size={14} /> {uploading === kind ? 'Uploading…' : doc ? 'Replace' : 'Upload for partner'}
                      <input type="file" multiple hidden disabled={uploading === kind} onChange={(e) => onUpload(kind, e.target.files)} />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
        ))}

        {approval?.canDecide && stage && stage !== 'approved' && (
          <div className={styles.decideBar}>
            <div className={styles.decideText}>
              Your decision as <strong>{PARTNER_APPROVAL_LABEL[stage]}</strong> — review the documents above first.
            </div>
            <div className={styles.decideButtons}>
              <button type="button" className={styles.rejectBtn} disabled={deciding} onClick={() => { setRejectKinds([]); setRejectNote(''); setRejectOpen(true); }}>
                <X size={15} /> Send back
              </button>
              <button type="button" className={styles.approveBtn} disabled={deciding} onClick={() => { setApproveNote(''); setApproveOpen(true); }}>
                <Check size={15} /> Approve
              </button>
            </div>
          </div>
        )}

        {trail.length > 0 && (
          <details className={styles.history}>
            <summary>Approval history ({trail.length})</summary>
            <ul>
              {[...trail].reverse().map((e, i) => (
                <li key={i}>
                  <strong>{e.decision === 'approved' ? 'Approved' : 'Sent back'}</strong> by {e.by_name} ({PARTNER_APPROVAL_LABEL[e.stage]}) · {fmt(e.at)}
                  {e.remarks ? ` — “${e.remarks}”` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {approveOpen && stage && stage !== 'approved' && (
        <Modal
          title={`Approve as ${PARTNER_APPROVAL_LABEL[stage]}`}
          ariaLabel="Approve onboarding documents"
          onClose={() => setApproveOpen(false)}
          dismissible={!deciding}
          footer={
            <>
              <ModalCancelButton onClick={() => setApproveOpen(false)} disabled={deciding}>Cancel</ModalCancelButton>
              <button
                type="button"
                className={styles.approveBtn}
                disabled={deciding}
                onClick={async () => { if (await onDecide('approved', approveNote, [])) setApproveOpen(false); }}
              >
                {deciding ? 'Saving…' : 'Approve'}
              </button>
            </>
          }
        >
          <p className={styles.modalText}>
            {stage === 'admin'
              ? `This is the final approval. ${partner.company_name} will get full portal access and can start work.`
              : `${partner.company_name} moves to the ${PARTNER_APPROVAL_LABEL[PARTNER_APPROVAL_STAGES[PARTNER_APPROVAL_STAGES.indexOf(stage) + 1]]} next.`}
          </p>
          <label className={styles.modalLabel} htmlFor="approve-note">Note (optional)</label>
          <textarea id="approve-note" className={styles.modalInput} rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
        </Modal>
      )}

      {rejectOpen && stage && stage !== 'approved' && (
        <Modal
          title="Send documents back to the partner"
          ariaLabel="Reject onboarding documents"
          onClose={() => setRejectOpen(false)}
          dismissible={!deciding}
          footer={
            <>
              <ModalCancelButton onClick={() => setRejectOpen(false)} disabled={deciding}>Cancel</ModalCancelButton>
              <button
                type="button"
                className={styles.rejectBtnSolid}
                disabled={deciding || !rejectNote.trim()}
                onClick={async () => { if (await onDecide('rejected', rejectNote, rejectKinds)) setRejectOpen(false); }}
              >
                {deciding ? 'Saving…' : 'Send back'}
              </button>
            </>
          }
        >
          <p className={styles.modalText}>Pick which documents need replacing (none picked = all). Approval restarts from the Sales Manager once the partner re-uploads.</p>
          <div className={styles.checkList}>
            {PARTNER_DOCUMENT_KINDS.map((kind) => (
              <label key={kind} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={rejectKinds.includes(kind)}
                  onChange={(e) => setRejectKinds((k) => (e.target.checked ? [...k, kind] : k.filter((x) => x !== kind)))}
                />
                {PARTNER_DOCUMENT_LABEL[kind]}
              </label>
            ))}
          </div>
          <label className={styles.modalLabel} htmlFor="reject-note">What needs correcting? * <span className={styles.muted}>(the partner sees this)</span></label>
          <textarea id="reject-note" className={styles.modalInput} rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </Modal>
      )}
    </>
  );
}
