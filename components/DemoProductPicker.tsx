'use client';

import { DemoProductLine, DomainKey } from '@/lib/types';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { DEMO_MODEL_SEPARATOR, getDemoProductGroups } from '@/lib/domainProducts';
import styles from './demoProductPicker.module.css';

// Demo Schedule picker: Domain → Product → Model → Qty.
//  - Every catalog product offers its models in a dropdown, plus
//    "Other (type model name)".
//  - Every domain also has "Other product" for anything not in the catalog.
//  - "Other domain" covers a domain outside AV / Robotics / AI / SI / VisitIQ.
//
// Each line is still one string, so nothing changes server-side:
//   "AV: Conferencing Cameras & Microphones — NT-EC-VB-4K (Video Bar)"   catalog product + model
//   "Robotics: Delivery Robot — Custom T12"                               catalog product + typed model
//   "Robotics: Window Cleaning Robot — WX-1"                              "Other product" + model
//   "Other (Drones): Inspection drone"                                    "Other domain"
// Half-typed lines are cleaned (or dropped) by cleanDemoProductName on the API.

const OTHER = '__other__';
const ALL_DOMAINS = Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[];
const OTHER_DOMAIN_RE = /^Other \(([^)]*)\): ([\s\S]*)$/;

interface Parsed {
  domainLabel: string;
  product: string;
  model: string | null;
}

function parse(tag: string): Parsed | null {
  if (OTHER_DOMAIN_RE.test(tag)) return null;
  const i = tag.indexOf(': ');
  if (i < 0) return null;
  const rest = tag.slice(i + 2);
  const j = rest.indexOf(DEMO_MODEL_SEPARATOR);
  return { domainLabel: tag.slice(0, i), product: j < 0 ? rest : rest.slice(0, j), model: j < 0 ? null : rest.slice(j + DEMO_MODEL_SEPARATOR.length) };
}

const serialize = (domainLabel: string, product: string, model: string | null) =>
  `${domainLabel}: ${product}${model === null ? '' : DEMO_MODEL_SEPARATOR + model}`;

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className={styles.qty} title="Quantity">
      <span>QTY</span>
      <input type="number" min={1} value={value} onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))} />
    </label>
  );
}

export default function DemoProductPicker({
  domains,
  onDomainsChange,
  lines,
  onChange
}: {
  domains: DomainKey[];
  onDomainsChange: (next: DomainKey[]) => void;
  lines: DemoProductLine[];
  onChange: (next: DemoProductLine[]) => void;
}) {
  const update = (index: number, product: string) => onChange(lines.map((l, i) => (i === index ? { ...l, product } : l)));
  const setQty = (index: number, quantity: number) => onChange(lines.map((l, i) => (i === index ? { ...l, quantity } : l)));
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));
  const add = (product: string) => onChange([...lines, { product, quantity: 1 }]);
  const indexed = lines.map((l, i) => ({ l, i, p: parse(l.product) }));

  const otherDomainRows = indexed.filter(({ l }) => OTHER_DOMAIN_RE.test(l.product));
  const otherDomainOn = otherDomainRows.length > 0;

  function toggleDomain(d: DomainKey) {
    const label = DOMAIN_DISPLAY_NAME[d];
    if (domains.includes(d)) {
      onDomainsChange(domains.filter((x) => x !== d));
      onChange(lines.filter((l) => parse(l.product)?.domainLabel !== label));
    } else {
      onDomainsChange([...domains, d]);
    }
  }

  return (
    <div className={styles.wrap}>
      <div>
        <span className={styles.sectionLabel}>Domain(s) demonstrated</span>
        <div className={styles.chips}>
          {ALL_DOMAINS.map((d) => {
            const on = domains.includes(d);
            return (
              <label key={d} className={`${styles.chip} ${on ? styles.chipOn : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggleDomain(d)} />
                <span className={styles.tick}>{on ? '✓' : '+'}</span>
                {DOMAIN_DISPLAY_NAME[d]}
              </label>
            );
          })}
          <label className={`${styles.chip} ${otherDomainOn ? styles.chipOn : ''}`}>
            <input
              type="checkbox"
              checked={otherDomainOn}
              onChange={() => (otherDomainOn ? onChange(lines.filter((l) => !OTHER_DOMAIN_RE.test(l.product))) : add('Other (): '))}
            />
            <span className={styles.tick}>{otherDomainOn ? '✓' : '+'}</span>
            Other domain
          </label>
        </div>
      </div>

      {domains.map((d) => {
        const label = DOMAIN_DISPLAY_NAME[d];
        const groups = getDemoProductGroups(d);
        const known = new Set(groups.map((g) => g.product));
        const mine = indexed.filter(({ p }) => p?.domainLabel === label);
        const customRows = mine.filter(({ p }) => p && !known.has(p.product));

        return (
          <div key={d} className={styles.panel}>
            <div className={styles.panelTitle}>
              {label} — products &amp; models
              <span className={styles.panelHint}>Tick a product, then pick its model</span>
            </div>
            <div className={styles.products}>
              {groups.map((g) => {
                const rows = mine.filter(({ p }) => p?.product === g.product);
                const on = rows.length > 0;
                return (
                  <div key={g.product} className={`${styles.product} ${on ? styles.productOn : ''}`}>
                    <label className={styles.productHead}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          on ? onChange(lines.filter((l) => { const p = parse(l.product); return !(p?.domainLabel === label && p.product === g.product); })) : add(serialize(label, g.product, null))
                        }
                      />
                      {g.product}
                      {g.models.length > 0 && <span className={styles.count}>{g.models.length} models</span>}
                    </label>
                    {on && (
                      <div className={styles.rows}>
                        {rows.map(({ l, i, p }) => {
                          const model = p!.model;
                          const isOther = model !== null && !g.models.includes(model);
                          return (
                            <div key={i} className={styles.row}>
                              <select
                                className={styles.select}
                                value={model === null ? '' : isOther ? OTHER : model}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  update(i, serialize(label, g.product, v === '' ? null : v === OTHER ? '' : v));
                                }}
                              >
                                <option value="">{g.models.length ? 'Select model…' : 'Model (optional)…'}</option>
                                {g.models.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                                <option value={OTHER}>Other (type model name)</option>
                              </select>
                              {isOther && (
                                <input
                                  className={styles.input}
                                  placeholder="Type model name"
                                  autoFocus
                                  value={model ?? ''}
                                  onChange={(e) => update(i, serialize(label, g.product, e.target.value.replace(/^\s+/, '')))}
                                />
                              )}
                              <Qty value={l.quantity} onChange={(n) => setQty(i, n)} />
                              {rows.length > 1 && (
                                <button type="button" className={styles.iconBtn} onClick={() => remove(i)} aria-label="Remove this model">✕</button>
                              )}
                            </div>
                          );
                        })}
                        <button type="button" className={styles.addBtn} onClick={() => add(serialize(label, g.product, null))}>
                          + Add another model
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Anything in this domain the catalog doesn't list. */}
              <div className={`${styles.product} ${customRows.length ? styles.productOn : ''}`}>
                <label className={styles.productHead}>
                  <input
                    type="checkbox"
                    checked={customRows.length > 0}
                    onChange={() =>
                      customRows.length
                        ? onChange(lines.filter((_, idx) => !customRows.some((r) => r.i === idx)))
                        : add(serialize(label, '', null))
                    }
                  />
                  Other product (not in list)
                </label>
                {customRows.length > 0 && (
                  <div className={styles.rows}>
                    {customRows.map(({ l, i, p }) => (
                      <div key={i} className={styles.row}>
                        <input
                          className={styles.input}
                          placeholder={`${label} product name`}
                          value={p!.product}
                          onChange={(e) => update(i, serialize(label, e.target.value.replace(/^\s+/, '').replace(/ — /g, ' - '), p!.model))}
                        />
                        <input
                          className={styles.input}
                          placeholder="Model (optional)"
                          value={p!.model ?? ''}
                          onChange={(e) => update(i, serialize(label, p!.product, e.target.value ? e.target.value.replace(/^\s+/, '') : null))}
                        />
                        <Qty value={l.quantity} onChange={(n) => setQty(i, n)} />
                        {customRows.length > 1 && (
                          <button type="button" className={styles.iconBtn} onClick={() => remove(i)} aria-label="Remove">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button" className={styles.addBtn} onClick={() => add(serialize(label, '', null))}>
                      + Add another product
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {otherDomainOn && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>
            Other domain
            <span className={styles.panelHint}>For anything outside the listed domains</span>
          </div>
          <div className={styles.rows} style={{ padding: 0 }}>
            {otherDomainRows.map(({ l, i }) => {
              const m = OTHER_DOMAIN_RE.exec(l.product)!;
              const set = (dom: string, prod: string) => update(i, `Other (${dom.replace(/[()]/g, '').replace(/^\s+/, '')}): ${prod.replace(/^\s+/, '')}`);
              return (
                <div key={i} className={styles.row}>
                  <input className={styles.input} placeholder="Domain name (e.g. Drones)" value={m[1]} onChange={(e) => set(e.target.value, m[2])} />
                  <input className={styles.input} placeholder="Product / model" value={m[2]} onChange={(e) => set(m[1], e.target.value)} />
                  <Qty value={l.quantity} onChange={(n) => setQty(i, n)} />
                  {otherDomainRows.length > 1 && (
                    <button type="button" className={styles.iconBtn} onClick={() => remove(i)} aria-label="Remove">✕</button>
                  )}
                </div>
              );
            })}
            <button type="button" className={styles.addBtn} onClick={() => add('Other (): ')}>
              + Add another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
