'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { composeQuote } from '@/lib/calculations';
import { generateQuotationPdf } from '@/lib/pdf';
import { computeQuotationPrefix, generateDraftQuotationNumber, refreshDraftQuotationNumber } from '@/lib/quotationNumber';
import { AvProjectType, CartItem, CostInputs, CustomProduct, Discount, DomainKey, DomainResult, ProjectRecord, QuotationDetails, UserRole } from '@/lib/types';
import { getRoomSuggestions } from '@/lib/roomSuggestions';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import { BRAND } from '@/lib/branding';
import StandeeEstimator from './estimators/StandeeEstimator';
import LedEstimator, { LedModelPreset } from './estimators/LedEstimator';
import ConferenceEstimator, { ModelPreset } from './estimators/ConferenceEstimator';
import InteractivePanelEstimator from './estimators/InteractivePanelEstimator';
import CablesEstimator from './estimators/CablesEstimator';
import RoboticsEstimator from './estimators/RoboticsEstimator';
import AiAnalyticsEstimator from './estimators/AiAnalyticsEstimator';
import SiEstimator from './estimators/SiEstimator';
import VisitIqEstimator from './estimators/VisitIqEstimator';
import QuotationDetailsForm from './QuotationDetailsForm';
import CostInputsSection from './CostInputsSection';
import CartList from './CartList';
import DiscountsList from './DiscountsList';
import CustomProductsList from './CustomProductsList';
import SummaryPanel from './SummaryPanel';
import styles from './calculator.module.css';

const DEFAULT_COST_INPUTS: CostInputs = { installationCost: 0, fabricationCost: 0, scaffoldingCost: 0, markupPercent: 0 };

const ROLE_LABELS: Record<UserRole, string> = { superadmin: 'Super Admin', admin: 'Admin', manager: 'Manager', technical: 'Technical Team', backoffice: 'Back Office', user: 'User' };
const ROLE_PILL_CLASS: Record<UserRole, string> = {
  superadmin: styles.rolePillSuperadmin,
  admin: styles.rolePillAdmin,
  manager: styles.rolePillManager,
  technical: styles.rolePillTechnical,
  backoffice: styles.rolePillBackoffice,
  user: styles.rolePillUser
};

export interface CurrentUser {
  username: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
}

function defaultDetails(currentUser: CurrentUser): QuotationDetails {
  return {
    quotationNumber: generateDraftQuotationNumber(computeQuotationPrefix([])),
    preparedBy: currentUser.name,
    preparedByPhone: currentUser.phone,
    preparedByEmail: currentUser.email,
    clientName: '',
    clientCompany: '',
    clientEmail: '',
    clientPhone: '',
    clientAddress: '',
    projectVertical: '',
    validityDays: 7,
    customTerms: ''
  };
}

interface QuotationCalculatorProps {
  currentUser: CurrentUser;
}

function QuotationCalculatorContent({ currentUser }: QuotationCalculatorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Nothing is pre-selected — on login and again after every "Add to Quote",
  // the domain/product-type pickers start blank so a sales rep always has to
  // make an explicit choice for the next product, instead of a leftover
  // selection looking like it's still pending or getting added twice.
  const [domain, setDomain] = useState<DomainKey | ''>('');
  const [avProjectType, setAvProjectType] = useState<AvProjectType | ''>('');
  const [costInputs, setCostInputs] = useState<CostInputs>(DEFAULT_COST_INPUTS);
  const [details, setDetails] = useState<QuotationDetails>(() => defaultDetails(currentUser));
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [customProducts, setCustomProducts] = useState<CustomProduct[]>([]);
  const [activeResult, setActiveResult] = useState<DomainResult | null>(null);
  const [logStatus, setLogStatus] = useState<{ text: string; color: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [roomSeats, setRoomSeats] = useState(10);
  const [interactivePanelPreset, setInteractivePanelPreset] = useState<ModelPreset | null>(null);
  const [conferencePreset, setConferencePreset] = useState<ModelPreset | null>(null);
  const [cablesPreset, setCablesPreset] = useState<ModelPreset | null>(null);
  const [ledPreset, setLedPreset] = useState<LedModelPreset | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || '');
  const [savedQuotation, setSavedQuotation] = useState<{ id: string; quotation_number: string } | null>(null);
  const [movingToDemo, setMovingToDemo] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProjectRecord[]) => setProjects(data))
      .catch(() => setProjects([]));
  }, []);

  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId) || null, [projects, projectId]);

  const nextId = useRef(1);
  const presetNonce = useRef(1);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const roomSuggestions = useMemo(() => getRoomSuggestions(roomSeats), [roomSeats]);

  function applyRoomSuggestion(item: (typeof roomSuggestions.items)[number]) {
    setAvProjectType(item.avProjectType);
    const nonce = presetNonce.current++;
    if (item.avProjectType === 'interactive-panel') setInteractivePanelPreset({ nonce, modelKey: item.modelKey });
    else if (item.avProjectType === 'conference') setConferencePreset({ nonce, modelKey: item.modelKey });
    else if (item.avProjectType === 'cables') setCablesPreset({ nonce, modelKey: item.modelKey });
    else if (item.avProjectType === 'led' && item.ledDimensions) {
      setLedPreset({ nonce, modelKey: item.modelKey, heightFt: item.ledDimensions.heightFt, widthFt: item.ledDimensions.widthFt });
    }
  }

  const activeDomains = useMemo(() => {
    const domains = new Set(cartItems.map((i) => i.domainKey));
    if (activeResult) domains.add(activeResult.domainKey);
    else if (domain) domains.add(domain);
    return [...domains];
  }, [cartItems, activeResult, domain]);

  function patchQuotationNumberForDomains(domains: DomainKey[]) {
    const prefix = computeQuotationPrefix(domains);
    setDetails((d) => ({ ...d, quotationNumber: refreshDraftQuotationNumber(d.quotationNumber, prefix) }));
  }

  function handleDomainChange(next: DomainKey | '') {
    setDomain(next);
    setAvProjectType('');
    setActiveResult(null);
    const domains = new Set(cartItems.map((i) => i.domainKey));
    if (next) domains.add(next);
    patchQuotationNumberForDomains([...domains]);
  }

  const composition = useMemo(
    () => composeQuote({ activeResult, cartItems, customProducts, discounts, markupPercent: costInputs.markupPercent }),
    [activeResult, cartItems, customProducts, discounts, costInputs.markupPercent]
  );

  const cartTotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
  const customProductsTotal = customProducts.reduce((sum, item) => sum + Math.max(1, Math.round(item.qty) || 1) * (Number(item.price) || 0), 0);

  function handleAddToQuote() {
    if (!activeResult || !activeResult.lineItems.length) {
      alert('Configure a product above before adding it to the quote.');
      return;
    }
    const newItem: CartItem = { ...activeResult, id: nextId.current++ };
    setCartItems((prev) => [...prev, newItem]);
    const domains = new Set(cartItems.map((i) => i.domainKey));
    domains.add(activeResult.domainKey);
    patchQuotationNumberForDomains([...domains]);

    // Force an explicit choice for the next product — leaving the just-added
    // configuration on screen reads as "still pending" to sales reps and
    // risks it being duplicated or mistaken for not-yet-added.
    setDomain('');
    setAvProjectType('');
    setActiveResult(null);
    setInteractivePanelPreset(null);
    setConferencePreset(null);
    setCablesPreset(null);
    setLedPreset(null);
    setResetKey((k) => k + 1);
  }

  function buildQuotationPayload() {
    const products = composition.productGroups
      .filter((g) => g.end > g.start)
      .map((g) => ({ label: g.label, lineItems: composition.lineItems.slice(g.start, g.end), remark: g.remark }));
    const domainSummary = activeDomains.map((d) => DOMAIN_DISPLAY_NAME[d] || d).join(', ');
    return {
      domains: activeDomains,
      projectId,
      preparedBy: details.preparedBy,
      preparedByPhone: details.preparedByPhone,
      preparedByEmail: details.preparedByEmail,
      clientName: details.clientName,
      clientCompany: details.clientCompany,
      clientEmail: details.clientEmail,
      clientPhone: details.clientPhone,
      clientAddress: details.clientAddress,
      projectVertical: details.projectVertical,
      domainSummary,
      productsSummary: products.map((p) => p.label).join('; '),
      products,
      subtotal: composition.totals.subtotal,
      markupPercent: composition.totals.markup,
      discountTotal: composition.totals.discountTotal,
      gstAmount: composition.totals.gstAmount,
      total: composition.totals.total,
      validityDays: details.validityDays
    };
  }

  async function saveQuotationToServer(): Promise<{ id: string; quotation_number: string } | null> {
    try {
      const response = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQuotationPayload())
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const record = await response.json();
      setDetails((d) => ({ ...d, quotationNumber: record.quotation_number }));
      setLogStatus({ text: `Saved to quotation log as ${record.quotation_number}.`, color: '#15803d' });
      setSavedQuotation({ id: record.id, quotation_number: record.quotation_number });
      return record;
    } catch {
      setLogStatus({
        text: 'Quotation record server not reachable — PDF generated locally but NOT logged.',
        color: '#b91c1c'
      });
      return null;
    }
  }

  async function handleMoveToDemo() {
    if (!savedQuotation) return;
    setMovingToDemo(true);
    try {
      const response = await fetch(`/api/quotations/${savedQuotation.id}/move-to-demo`, { method: 'POST' });
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json();
      setProjects((prev) => prev.map((p) => (p.id === json.project?.id ? json.project : p)));
      router.push(`/demo-schedule?projectId=${projectId}`);
    } catch {
      alert('Could not move this project to the Demo stage.');
    } finally {
      setMovingToDemo(false);
    }
  }

  async function handleDownloadPdf() {
    setPdfBusy(true);
    try {
      const record = await saveQuotationToServer();
      const quotationNumber = record?.quotation_number || details.quotationNumber || generateDraftQuotationNumber(computeQuotationPrefix(activeDomains));
      await generateQuotationPdf({
        quotationNumber,
        preparedBy: details.preparedBy,
        preparedByPhone: details.preparedByPhone,
        preparedByEmail: details.preparedByEmail,
        clientCompany: details.clientCompany,
        clientName: details.clientName,
        clientEmail: details.clientEmail,
        clientPhone: details.clientPhone,
        clientAddress: details.clientAddress,
        projectVertical: details.projectVertical,
        validityDays: details.validityDays,
        customTerms: details.customTerms,
        lineItems: composition.lineItems,
        productGroups: composition.productGroups,
        totals: composition.totals
      });
    } catch (error) {
      alert('PDF library failed to load or generate. Check your internet connection and try again.');
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      setPdfBusy(false);
    }
  }

  function handleReset() {
    setDomain('');
    setAvProjectType('');
    setCostInputs(DEFAULT_COST_INPUTS);
    setDetails(defaultDetails(currentUser));
    setCartItems([]);
    setDiscounts([]);
    setCustomProducts([]);
    setActiveResult(null);
    setLogStatus(null);
    setResetKey((k) => k + 1);
    setRoomSeats(10);
    setInteractivePanelPreset(null);
    setConferencePreset(null);
    setCablesPreset(null);
    setLedPreset(null);
    setSavedQuotation(null);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  const isAv = domain === 'av';
  const showScaffolding = isAv && (avProjectType === 'standee' || avProjectType === 'led');

  return (
    <div className={styles.page}>
      <main className={styles.converter}>
        <div className={styles.authBar}>
          <span className={styles.small}>
            Signed in as <strong>{currentUser.name}</strong>
            <span className={`${styles.rolePill} ${ROLE_PILL_CLASS[currentUser.role]}`}>{ROLE_LABELS[currentUser.role]}</span>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className={styles.secondaryButton} href="/">
              &larr; Dashboard
            </a>
            {currentUser.role !== 'user' && currentUser.role !== 'technical' && currentUser.role !== 'backoffice' && (
              <a className={styles.secondaryButton} href="/quotation-history" target="_blank" rel="noreferrer">
                Quotation History
              </a>
            )}
            <button type="button" className={styles.secondaryButton} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
        <div className={styles.brandHeader}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={50} height={50} className={styles.brandLogo} unoptimized />
          <div className={styles.brandTitle}>
            <h1 className={styles.h1}>Sales Quotation Estimator</h1>
            <span className={styles.tagline}>NANTA-branded estimator for standee and LED display pricing</span>
          </div>
        </div>
        <p className={styles.p}>Estimate Robotics, AV, and AI Video Analytics costs with model-based pricing and installation/fabrication/scaffolding costs.</p>

        <div className={styles.domainPanel}>
          <div className={`${styles.row} ${styles.columns}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="projectSelect">Project</label>
              <select id="projectSelect" className={styles.formControl} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">-- No project (one will be created) --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name} ({PROJECT_STAGE_LABEL[p.stage]})</option>
                ))}
              </select>
              {selectedProject && <div className={styles.small}>Stage: {PROJECT_STAGE_LABEL[selectedProject.stage]}</div>}
            </div>
          </div>
          <div className={`${styles.row} ${styles.columns}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="domainSelect">Domain</label>
              <select id="domainSelect" className={styles.formControl} value={domain} onChange={(e) => handleDomainChange(e.target.value as DomainKey | '')}>
                <option value="">-- Select domain --</option>
                <option value="av">AV</option>
                <option value="robotics">Robotics</option>
                <option value="ai">AI Video Analytics (Video Management System)</option>
                <option value="si">System Integration</option>
                <option value="visitiq">VisitIQ VMS (Visitor Management System)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="projectVertical">Project vertical (optional)</label>
              <select
                id="projectVertical"
                className={styles.formControl}
                value={details.projectVertical}
                onChange={(e) => setDetails((d) => ({ ...d, projectVertical: e.target.value }))}
              >
                <option value="">Not specified</option>
                <option value="Corporate">Corporate</option>
                <option value="Retail">Retail</option>
                <option value="Education">Education</option>
                <option value="Hospitality">Hospitality</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Government">Government</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        {isAv && (
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="projectType">Project type</label>
              <select id="projectType" className={styles.formControl} value={avProjectType} onChange={(e) => setAvProjectType(e.target.value as AvProjectType | '')}>
                <option value="">-- Select product type --</option>
                <option value="av-solution">AV Solution (suggest by room size)</option>
                <option value="standee">Standee</option>
                <option value="led">LED Display</option>
                <option value="interactive-panel">Interactive Flat Panel</option>
                <option value="conference">Conferencing Cameras &amp; Microphones</option>
                <option value="cables">AV Cables</option>
              </select>
            </div>
          </div>
        )}

        {((!domain) || (isAv && !avProjectType)) && (
          <div className={styles.domainPanel}>
            <div className={styles.small}>
              {!domain
                ? 'Select a domain above to start configuring a product for this quote.'
                : 'Select a product type above to start configuring this product.'}
            </div>
          </div>
        )}

        {isAv && avProjectType === 'av-solution' && (
          <div className={styles.domainPanel}>
            <h2 className={styles.h2}>AV Solution</h2>
            <div className={`${styles.row} ${styles.columns}`}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="roomSeats">Room size (number of seats)</label>
                <input
                  id="roomSeats"
                  className={styles.formControl}
                  type="number"
                  step={1}
                  min={1}
                  value={roomSeats}
                  onChange={(e) => setRoomSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Suggested for</label>
                <div className={styles.small} style={{ paddingTop: 10 }}>{roomSuggestions.tierLabel}</div>
              </div>
            </div>
            <div className={styles.small} style={{ marginBottom: 8 }}>
              Tailored suggestions across every AV product category for this room size — click one to switch the project type and apply it. (Standees are lobby/signage kiosks, so they're not sized by seat count.)
            </div>
            {roomSuggestions.items.map((item) => (
              <div key={item.avProjectType} className={styles.lineItemRow}>
                <span style={{ flex: 1 }}>
                  <strong>{item.categoryLabel}:</strong> {item.modelLabel} — {item.reason}
                </span>
                <button type="button" className={styles.secondaryButton} onClick={() => applyRoomSuggestion(item)}>
                  Use this
                </button>
              </div>
            ))}
          </div>
        )}

        <StandeeEstimator key={`standee-${resetKey}`} active={isAv && avProjectType === 'standee'} costInputs={costInputs} onResultChange={setActiveResult} />
        <LedEstimator key={`led-${resetKey}`} active={isAv && avProjectType === 'led'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={ledPreset} />
        <ConferenceEstimator key={`conference-${resetKey}`} active={isAv && avProjectType === 'conference'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={conferencePreset} />
        <InteractivePanelEstimator key={`ifp-${resetKey}`} active={isAv && avProjectType === 'interactive-panel'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={interactivePanelPreset} />
        <CablesEstimator key={`cables-${resetKey}`} active={isAv && avProjectType === 'cables'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={cablesPreset} />
        <RoboticsEstimator key={`robotics-${resetKey}`} active={domain === 'robotics'} onResultChange={setActiveResult} />
        <AiAnalyticsEstimator key={`ai-${resetKey}`} active={domain === 'ai'} onResultChange={setActiveResult} />
        <SiEstimator key={`si-${resetKey}`} active={domain === 'si'} onResultChange={setActiveResult} />
        <VisitIqEstimator key={`visitiq-${resetKey}`} active={domain === 'visitiq'} onResultChange={setActiveResult} />

        <QuotationDetailsForm details={details} onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))} />

        <h2 className={styles.h2}>Cost Inputs</h2>
        <div className={styles.sectionPanel}>
          <CostInputsSection
            costInputs={costInputs}
            onChange={(patch) => setCostInputs((c) => ({ ...c, ...patch }))}
            showInstallFabrication={isAv}
            showScaffolding={showScaffolding}
          />

          <CartList
            items={cartItems}
            onAdd={handleAddToQuote}
            onRemove={(id) => {
              setCartItems((prev) => prev.filter((p) => p.id !== id));
              const domains = new Set(cartItems.filter((p) => p.id !== id).map((i) => i.domainKey));
              if (domain) domains.add(domain);
              patchQuotationNumberForDomains([...domains]);
            }}
            onChangeRemark={(id, remark) => {
              setCartItems((prev) => prev.map((p) => (p.id === id ? { ...p, remark } : p)));
            }}
          />

          <DiscountsList
            discounts={discounts}
            onAdd={() => setDiscounts((prev) => [...prev, { id: nextId.current++, label: 'Discount', type: 'percent', value: 0 }])}
            onChangeItem={(id, patch) => setDiscounts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))}
            onRemove={(id) => setDiscounts((prev) => prev.filter((d) => d.id !== id))}
          />

          <CustomProductsList
            products={customProducts}
            onAdd={() => setCustomProducts((prev) => [...prev, { id: nextId.current++, name: '', qty: 1, price: 0 }])}
            onChangeItem={(id, patch) => setCustomProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))}
            onRemove={(id) => setCustomProducts((prev) => prev.filter((p) => p.id !== id))}
          />

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Calculate Estimate
            </button>
            <button type="button" className={styles.btn} disabled={pdfBusy} onClick={handleDownloadPdf}>
              {pdfBusy ? 'Working…' : 'Download PDF'}
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={handleReset}>
              Reset All
            </button>
          </div>
          {logStatus && (
            <div className={styles.small} style={{ color: logStatus.color }}>
              {logStatus.text}
            </div>
          )}
          {savedQuotation && (
            <div className={styles.small} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {projectId ? (
                <>
                  <span>
                    Project <Link href={`/projects/${projectId}`}>{projectId}</Link>
                    {selectedProject ? ` · Stage: ${PROJECT_STAGE_LABEL[selectedProject.stage]}` : ''}
                  </span>
                  <button type="button" className={styles.secondaryButton} disabled={movingToDemo} onClick={handleMoveToDemo}>
                    {movingToDemo ? 'Moving…' : 'Move to Demo'}
                  </button>
                </>
              ) : (
                <span>This quotation wasn&apos;t linked to a project — select one above next time to track it through the pipeline.</span>
              )}
            </div>
          )}
        </div>

        <div ref={summaryRef}>
          <SummaryPanel
            activeResult={activeResult}
            cartCount={cartItems.length}
            cartSubtotal={cartTotal}
            customProductsTotal={customProductsTotal}
            totals={composition.totals}
          />
        </div>
      </main>
    </div>
  );
}

export default function QuotationCalculator({ currentUser }: QuotationCalculatorProps) {
  return (
    <Suspense fallback={<div className={styles.page} />}>
      <QuotationCalculatorContent currentUser={currentUser} />
    </Suspense>
  );
}
