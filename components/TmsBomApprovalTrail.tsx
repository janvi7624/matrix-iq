'use client';

import { BomStage, bomApprovalTrail, BomChainInput } from '@/lib/tmsBomApprovalChain';
import styles from './tmsBomApprovalTrail.module.css';

// "Where is it pending, and where was it approved" — the whole chain on
// screen, one row per step, so nobody has to interpret a single status badge
// to work out who is sitting on a BOM request.
//
// Reads its states from lib/tmsBomApprovalChain.ts rather than switching on
// the status here, so the trail, the pending line and the server's routing
// decisions all come from one description of the chain.

function formatWhen(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

const STATE_LABEL: Record<BomStage['state'], string> = {
  done: 'Approved',
  current: 'Pending',
  upcoming: 'Not started',
  rejected: 'Rejected',
  skipped: 'Not required'
};

export default function TmsBomApprovalTrail({ record, financeStageEnabled }: { record: BomChainInput; financeStageEnabled: boolean }) {
  const trail = bomApprovalTrail(record, financeStageEnabled);

  return (
    <ol className={styles.trail} aria-label="Approval chain">
      {trail.map((stage) => (
        <li key={stage.key} className={`${styles.step} ${styles[stage.state]}`}>
          <span className={styles.marker} aria-hidden="true" />
          <div className={styles.body}>
            <div className={styles.headRow}>
              <span className={styles.label}>{stage.label}</span>
              <span className={styles.state}>
                {stage.key === 'request' && stage.state === 'done' ? 'Submitted' : STATE_LABEL[stage.state]}
              </span>
            </div>
            <div className={styles.meta}>
              {/* Done steps name the person who did it; a pending step names
                  who it is waiting on, which is the question being asked. */}
              {stage.state === 'done' || stage.state === 'rejected'
                ? `${stage.actorName || stage.owner}${stage.at ? ` · ${formatWhen(stage.at)}` : ''}`
                : stage.state === 'skipped'
                  ? 'Not part of this chain'
                  : `With ${stage.owner}`}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
