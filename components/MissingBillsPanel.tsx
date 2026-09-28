'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { MissingBillClaim, MissingBillPerson, formatBillDate, formatRupees } from '@/lib/missingBillsShared';
import calcStyles from './calculator.module.css';
import styles from './missingBills.module.css';

interface AllScope {
  people: MissingBillPerson[];
  totalBills: number;
  totalClaims: number;
}

// Shown at the top of the Reimbursement page while any bill file can't be
// opened (the old file storage was lost — see lib/missingBills.ts). Two parts:
//  - the employee's own claims that need a bill uploaded again, one button per
//    lost file (works on already-approved claims, which the normal edit form
//    won't touch);
//  - for HR / Accounts / Admin, who is affected and a button that asks them all
//    to do it (in-app notification + email).
// Renders nothing at all once every bill can be opened again.
export default function MissingBillsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [mine, setMine] = useState<MissingBillClaim[]>([]);
  const [all, setAll] = useState<AllScope | null>(null);
  const [busyUrl, setBusyUrl] = useState('');
  const [asking, setAsking] = useState(false);
  const [askedAt, setAskedAt] = useState('');

  // Re-run by bumping reloadKey (after an upload). State is only set from the
  // fetch callbacks, never synchronously in the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/reimbursement/missing-bills')
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data: { claims: MissingBillClaim[]; canManage: boolean } | null) => {
        if (!data || cancelled) return;
        setMine(data.claims);
        if (!data.canManage) {
          setAll(null);
          return;
        }
        const allRes = await fetch('/api/reimbursement/missing-bills?scope=all');
        if (allRes.ok && !cancelled) setAll(await allRes.json());
      })
      .catch(() => {
        // A failed check must never get in the way of the page itself.
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function reupload(claim: MissingBillClaim, oldUrl: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusyUrl(oldUrl);
    try {
      const fd = new FormData();
      fd.append('folder', 'reimbursement');
      fd.append('files', file);
      const up = await fetch('/api/uploads', { method: 'POST', body: fd });
      const upData = await up.json().catch(() => null);
      if (!up.ok || !upData?.urls?.[0]) {
        toast.error(upData?.error || 'Upload failed. Please try again.');
        return;
      }
      const res = await fetch(`/api/reimbursement/${claim.claimId}/replace-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldUrl, newUrl: upData.urls[0] })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not attach the bill. Please try again.');
        return;
      }
      toast.success('Bill uploaded.');
      reload();
    } finally {
      setBusyUrl('');
    }
  }

  async function askEveryone() {
    if (!all) return;
    const reachable = all.people.filter((p) => p.active);
    const names = reachable.map((p) => p.name).join(', ');
    const ok = await confirm({
      title: 'Ask employees to upload their bills again?',
      message: `This sends an in-app notification and an email to ${reachable.length} employee${reachable.length === 1 ? '' : 's'} (${names}), asking each to re-upload the bills listed against their claims. Send it now?`,
      confirmLabel: 'Send request'
    });
    if (!ok) return;
    setAsking(true);
    try {
      const res = await fetch('/api/reimbursement/missing-bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not send the request. Please try again.');
        return;
      }
      setAskedAt(new Date().toLocaleString('en-IN'));
      toast.success(`Asked ${data.notified} employee${data.notified === 1 ? '' : 's'} to upload their bills again (${data.emailed} emailed).`);
    } finally {
      setAsking(false);
    }
  }

  const showMine = mine.length > 0;
  const showAll = !!all && all.people.length > 0;
  if (!showMine && !showAll) return null;

  return (
    <>
      {showMine && (
        <div className={styles.card} role="region" aria-label="Bills to upload again">
          <h2 className={styles.title}>{mine.reduce((n, c) => n + c.missingUrls.length, 0)} of your bills need to be uploaded again</h2>
          <p className={styles.lead}>
            The old file storage was lost, so these bill files can no longer be opened. Your claims and amounts are unchanged — please upload the original photo or PDF
            (from your phone or email) against each one.
          </p>
          <ul className={styles.list}>
            {mine.map((claim) =>
              claim.missingUrls.map((url, i) => (
                <li key={`${claim.claimId}-${url}`} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTitle}>
                      {formatBillDate(claim.date)} · {claim.description || 'Claim'} · {formatRupees(claim.amount)}
                    </div>
                    <div className={styles.itemMeta}>Lost file: {claim.missingFileNames[i]}</div>
                  </div>
                  <label className={`${styles.uploadBtn} ${busyUrl === url ? styles.uploadBtnBusy : ''}`}>
                    {busyUrl === url ? 'Uploading…' : 'Upload bill again'}
                    <input
                      type="file"
                      className={styles.hiddenInput}
                      accept="image/*,.pdf"
                      disabled={!!busyUrl}
                      onChange={(e) => {
                        const input = e.currentTarget;
                        const files = input.files;
                        reupload(claim, url, files).finally(() => { input.value = ''; });
                      }}
                    />
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {showAll && all && (
        <div className={styles.card} role="region" aria-label="Missing bills across employees">
          <h2 className={styles.title}>
            {`${all.totalBills} bill${all.totalBills === 1 ? '' : 's'} across ${all.people.length} employee${all.people.length === 1 ? '' : 's'} can't be opened`}
          </h2>
          <p className={styles.lead}>
            These files were lost with the old storage and only the employees still have the originals. Ask them to upload each bill again — they&apos;ll see the same list
            on this page, and it clears as they do.
          </p>
          <ul className={styles.people}>
            {all.people.map((p) => (
              <li key={p.username}>
                <strong>{p.name}</strong> <span className={styles.personMeta}>— {p.billCount} bill{p.billCount === 1 ? '' : 's'} on {p.claims.length} claim{p.claims.length === 1 ? '' : 's'}</span>
                {!p.active && <span className={styles.tag}>inactive account — can&apos;t be asked</span>}
                {p.active && !p.email && <span className={styles.tag}>no email on file — in-app notice only</span>}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={calcStyles.btn} onClick={askEveryone} disabled={asking || all.people.every((p) => !p.active)}>
              {asking ? 'Sending…' : 'Ask employees to upload again'}
            </button>
            {askedAt && <span className={styles.sentNote}>Request sent {askedAt}.</span>}
          </div>
        </div>
      )}
    </>
  );
}
