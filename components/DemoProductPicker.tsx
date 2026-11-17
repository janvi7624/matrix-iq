'use client';

import { DemoProductLine, DomainKey } from '@/lib/types';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { DEMO_MODEL_SEPARATOR, getDemoProductGroups } from '@/lib/domainProducts';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

// Demo Schedule product picker: Domain → Product → Model (dropdown, or
// "Other" to type one) → Qty. Several models of the same product can be added.
//
// Each line is stored as a single string so nothing changes server-side:
//   "AV: Conferencing Cameras & Microphones"                         (no model yet)
//   "AV: Conferencing Cameras & Microphones — NT-EC-VB-4K (Video Bar)" (catalog model)
//   "AV: Conferencing Cameras & Microphones — Logitech Rally"        (typed via Other)
//   "AV: Conferencing Cameras & Microphones — "                      (Other picked, not typed yet)
// The line for "Other with nothing typed" is trimmed back to the bare product by the API.

const OTHER = '__other__';

function splitLine(tag: string, base: string): { model: string | null } {
  if (tag === base) return { model: null };
  if (tag.startsWith(base + DEMO_MODEL_SEPARATOR)) return { model: tag.slice(base.length + DEMO_MODEL_SEPARATOR.length) };
  if (tag.startsWith(base + DEMO_MODEL_SEPARATOR.trimEnd())) return { model: '' };
  return { model: null };
}

function belongsTo(tag: string, base: string) {
  return tag === base || tag.startsWith(base + DEMO_MODEL_SEPARATOR.trimEnd());
}

export default function DemoProductPicker({
  domains,
  lines,
  onChange
}: {
  domains: DomainKey[];
  lines: DemoProductLine[];
  onChange: (next: DemoProductLine[]) => void;
}) {
  const update = (index: number, patch: Partial<DemoProductLine>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));

  return (
    <>
      {domains.map((d) => {
        const groups = getDemoProductGroups(d);
        const domainName = DOMAIN_DISPLAY_NAME[d];
        if (!groups.length) {
          return (
            <div key={d} className={`${calcStyles.small} ${calcStyles.mb8}`}>
              No fixed product catalog for {domainName} — describe what&apos;s required in Notes below.
            </div>
          );
        }
        return (
          <div key={d} className={calcStyles.field}>
            <label className={calcStyles.label}>{domainName} — products &amp; models</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map((g) => {
                const base = `${domainName}: ${g.product}`;
                const rows = lines.map((l, i) => ({ l, i })).filter(({ l }) => belongsTo(l.product, base));
                const checked = rows.length > 0;
                return (
                  <div
                    key={base}
                    style={{
                      border: '1px solid var(--mx-border, #e2e8f0)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: checked ? 'var(--mx-surface-2, #f8fafc)' : 'transparent'
                    }}
                  >
                    <label className={calcStyles.inlineFlexGap6} style={{ fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          checked ? onChange(lines.filter((l) => !belongsTo(l.product, base))) : onChange([...lines, { product: base, quantity: 1 }])
                        }
                      />
                      {g.product}
                    </label>

                    {rows.map(({ l, i }) => {
                      const { model } = splitLine(l.product, base);
                      const isOther = model !== null && !g.models.includes(model);
                      const selectValue = model === null ? '' : isOther ? OTHER : model;
                      return (
                        <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6, marginLeft: 22 }}>
                          <select
                            className={calcStyles.formControl}
                            style={{ flex: '1 1 220px', maxWidth: 360 }}
                            value={selectValue}
                            onChange={(e) => {
                              const v = e.target.value;
                              update(i, { product: v === '' ? base : v === OTHER ? base + DEMO_MODEL_SEPARATOR : base + DEMO_MODEL_SEPARATOR + v });
                            }}
                          >
                            <option value="">{g.models.length ? '-- Select model --' : '-- Model (optional) --'}</option>
                            {g.models.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            <option value={OTHER}>Other (type model name)</option>
                          </select>
                          {isOther && (
                            <input
                              className={calcStyles.formControl}
                              style={{ flex: '1 1 180px', maxWidth: 260 }}
                              placeholder="Type model / product name"
                              autoFocus
                              value={model ?? ''}
                              onChange={(e) => update(i, { product: base + DEMO_MODEL_SEPARATOR + e.target.value.replace(/^\s+/, '') })}
                            />
                          )}
                          <input
                            type="number"
                            min={1}
                            aria-label="Quantity"
                            title="Quantity"
                            className={`${calcStyles.formControl} ${calcStyles.qtyInputMini}`}
                            value={l.quantity}
                            onChange={(e) => update(i, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                          />
                          {rows.length > 1 && (
                            <button type="button" className={historyStyles.button} onClick={() => remove(i)} aria-label="Remove this model">
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {checked && (
                      <button
                        type="button"
                        className={historyStyles.button}
                        style={{ marginTop: 6, marginLeft: 22 }}
                        onClick={() => onChange([...lines, { product: base, quantity: 1 }])}
                      >
                        + Add another model
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
