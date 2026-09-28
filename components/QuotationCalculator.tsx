'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Package, Send, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { composeQuote } from '@/lib/calculations';
import { generateQuotationPdf } from '@/lib/pdf';
import { computeQuotationPrefix, generateDraftQuotationNumber, refreshDraftQuotationNumber } from '@/lib/quotationNumber';
import { AvProjectType, CartItem, CostInputs, CustomProduct, Discount, DomainKey, DomainResult, LineItem, ProjectRecord, PublicAppConfig, QuotationDetails, QuotationRecord, UserRole } from '@/lib/types';
import { getRoomSuggestions } from '@/lib/roomSuggestions';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import AppShell from './AppShell';
import StandeeEstimator from './estimators/StandeeEstimator';
import LedEstimator, { LedModelPreset } from './estimators/LedEstimator';
import ConferenceEstimator, { ModelPreset } from './estimators/ConferenceEstimator';
import InteractivePanelEstimator from './estimators/InteractivePanelEstimator';
import CablesEstimator from './estimators/CablesEstimator';
import RoboticsEstimator from './estimators/RoboticsEstimator';
import AiAnalyticsEstimator from './estimators/AiAnalyticsEstimator';
import SiEstimator from './estimators/SiEstimator';
import VisitIqEstimator from './estimators/VisitIqEstimator';
import { buildOverrideMap, CatalogOverrideRow, OverrideMap } from '@/lib/catalogOverrides';
import QuotationDetailsForm from './QuotationDetailsForm';
import { TeamMemberOption } from './ui/TeamMemberSelect';
import { canActOnBehalf } from '@/lib/quotationOnBehalfAccess';
import { isTechnicalRole } from '@/lib/technicalRoles';
import CostInputsSection from './CostInputsSection';
import CartList from './CartList';
import DiscountsList from './DiscountsList';
import CustomProductsList from './CustomProductsList';
import SummaryPanel from './SummaryPanel';
import { useToast } from './ui/ToastProvider';
import ProjectSelect from './ui/ProjectSelect';
import styles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';

const DEFAULT_COST_INPUTS: CostInputs = { installationCost: 0, fabricationCost: 0, scaffoldingCost: 0, markupPercent: 0 };

// Presented as 3 guided steps instead of one long scrolling form — a sales
// rep always knows exactly where they are and what's left to do.
const WIZARD_STEPS = [
  { icon: <Package size={18} />, label: 'Build the Quote' },
  { icon: <User size={18} />, label: 'Client Details' },
  { icon: <Send size={18} />, label: 'Review & Send' }
];

const ROLE_LABELS: Record<UserRole, string> = { superadmin: 'Super Admin', admin: 'Admin', manager: 'Manager', engineer: 'Engineer', 'technical-manager': 'Technical Manager', 'team-lead': 'Team Lead', technician: 'Technician', backoffice: 'Back Office', user: 'Sales', marketing: 'Marketing', accounts: 'Accounts', hr: 'HR' };
const ROLE_PILL_CLASS: Record<UserRole, string> = {
  superadmin: styles.rolePillSuperadmin,
  admin: styles.rolePillAdmin,
  manager: styles.rolePillManager,
  engineer: styles.rolePillTechnical,
  'technical-manager': styles.rolePillTechnical,
  'team-lead': styles.rolePillTechnical,
  technician: styles.rolePillTechnical,
  backoffice: styles.rolePillBackoffice,
  user: styles.rolePillUser,
  marketing: styles.rolePillMarketing,
  accounts: styles.rolePillAccounts,
  hr: styles.rolePillHr
};

export interface CurrentUser {
  id: string;
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
    preparedByUserId: currentUser.id,
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

function preparedByFields(member: { id: string; name: string; phone: string; email: string }): Pick<QuotationDetails, 'preparedBy' | 'preparedByPhone' | 'preparedByEmail' | 'preparedByUserId'> {
  return { preparedBy: member.name, preparedByPhone: member.phone, preparedByEmail: member.email, preparedByUserId: member.id };
}

const TECHNICAL_ON_BEHALF_HINT = "Defaults to the project's sales person — pick yourself to issue it in your own name.";

interface QuotationCalculatorProps {
  currentUser: CurrentUser;
  // Markup %, discounts, and custom-product pricing are locked for everyone
  // except Manager/Admin/Super Admin (Role Management's isPrivileged flag) —
  // a regular sales rep can configure and add products but can't change the
  // numbers that set profit margin.
  canEditPricing: boolean;
  // Role Management's isPrivileged flag (same value proxy.ts checks for the
  // /quotation-history admin-only route) — kept separate from canEditPricing
  // since they're different permissions that only happen to share a default;
  // an admin can toggle one without the other via Role Management.
  isPrivileged: boolean;
}

function QuotationCalculatorContent({ currentUser, canEditPricing, isPrivileged }: QuotationCalculatorProps) {
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
  const [logStatus, setLogStatus] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
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
  const [publicConfig, setPublicConfig] = useState<PublicAppConfig | null>(null);
  const [overrides, setOverrides] = useState<OverrideMap>(new Map());

  const reviseId = searchParams.get('reviseId') || '';
  const [revisingFrom, setRevisingFrom] = useState<{ id: string; quotationNumber: string } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');

  const toast = useToast();
  const [wizardStep, setWizardStep] = useState(0);
  const [stepError, setStepError] = useState('');
  // Purely a UX affordance — collapses the standard-catalog picker out of the
  // way for a custom-only quote. Never gates saving: cartItems and
  // customProducts both always count toward "has at least one product," and
  // switching back to Standard (or just expanding the collapsed catalog
  // section) never clears anything, so mixed quotations keep working.
  const [quotationMode, setQuotationMode] = useState<'standard' | 'custom'>('standard');

  function goNext() {
    if (wizardStep === 0 && cartItems.length === 0 && customProducts.length === 0) {
      setStepError('Add at least one product (standard or custom) to the quote before continuing.');
      return;
    }
    if (wizardStep === 1 && !details.clientName.trim() && !details.clientCompany.trim()) {
      setStepError("Enter the client's name or company before continuing.");
      return;
    }
    setStepError('');
    setWizardStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1));
  }

  function goBack() {
    setStepError('');
    setWizardStep((s) => Math.max(0, s - 1));
  }

  useEffect(() => {
    if (!reviseId) return;
    fetch(`/api/quotations/${reviseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((source: QuotationRecord | null) => {
        if (!source || !source.quotation_number) return;
        setRevisingFrom({ id: reviseId, quotationNumber: source.quotation_number });
        setProjectId(source.project_id || '');
        setDetails((d) => ({
          ...d,
          preparedBy: source.prepared_by || d.preparedBy,
          preparedByPhone: source.prepared_by_phone || d.preparedByPhone,
          preparedByEmail: source.prepared_by_email || d.preparedByEmail,
          // '' (a legacy quotation with no linked prepared-by user) falls
          // back to the CURRENT reviser's own id, matching what the API
          // treats as "no change" — see the revise route's isChangingPreparedBy.
          preparedByUserId: source.prepared_by_user_id || d.preparedByUserId,
          clientName: source.client_name || '',
          clientCompany: source.client_company || '',
          clientEmail: source.client_email || '',
          clientPhone: source.client_phone || '',
          clientAddress: source.client_address || '',
          projectVertical: source.project_vertical || '',
          validityDays: source.validity_days || d.validityDays
        }));

        // Carry the last quote's actual line items over as editable Custom
        // Products — the per-domain estimator wizards can't be "un-run" back
        // to their original inputs from a saved quote's flattened totals,
        // but every line item, quantity, and price the client already saw is
        // right here to tweak, remove, or add to, instead of the reviser
        // rebuilding the whole quote product-by-product from scratch.
        try {
          // The shape buildQuotationPayload() actually sends/saves as
          // products_json — grouped label + flattened LineItem[], not the
          // ProductGroup (start/end index) shape composition.productGroups
          // uses in memory.
          const groups: { label: string; lineItems: LineItem[]; remark?: string }[] = JSON.parse(source.products_json || '[]');
          // Negative, sequential ids — never collide with nextId.current's
          // own positive counter (used by every "+ Add" action elsewhere),
          // and mutating that shared ref from inside an effect is its own
          // hazard, so this avoids touching it at all.
          let seedId = -1;
          const items: CustomProduct[] = groups.flatMap((g) =>
            (g.lineItems || []).map((li) => ({
              id: seedId--,
              name: li.description || g.label,
              description: g.label,
              unit: li.unit || '',
              qty: Number(li.qty) || 1,
              price: Number(li.rate) || 0,
              remarks: g.remark || ''
            }))
          );
          if (items.length) {
            setCustomProducts(items);
            setQuotationMode('custom');
          }
        } catch {
          // Malformed/legacy products_json — leave the cart empty rather
          // than block the revision.
        }
        setCostInputs((c) => ({ ...c, markupPercent: source.markup_percent || 0 }));
        if (source.discount_total) {
          setDiscounts([{ id: -1_000_000, label: `Carried over from ${source.quotation_number}`, type: 'flat', value: source.discount_total }]);
        }
      })
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviseId]);

  useEffect(() => {
    fetch('/api/config/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PublicAppConfig | null) => setPublicConfig(data))
      .catch(() => setPublicConfig(null));
  }, []);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProjectRecord[]) => setProjects(data))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    fetch('/api/product-overrides')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CatalogOverrideRow[]) => setOverrides(buildOverrideMap(rows)))
      .catch(() => setOverrides(new Map()));
  }, []);

  const [onBehalfOptions, setOnBehalfOptions] = useState<TeamMemberOption[] | null>(null);
  useEffect(() => {
    if (!canActOnBehalf(currentUser.username)) return;
    fetch('/api/quotations/on-behalf-options')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TeamMemberOption[]) => setOnBehalfOptions(data))
      .catch(() => setOnBehalfOptions([]));
  }, [currentUser.username]);

  // Technical staff quoting on a project owned by a sales person: Prepared By
  // defaults to that owner, so the quotation is issued in their name and
  // lands in their Existing Quotations, with a two-option picker (self +
  // owner) to switch back. The allowlist path above takes precedence, and a
  // revision keeps the prepared-by it inherited from its source quotation.
  // Driven from the project picker's onChange (handleProjectOnBehalfChange)
  // rather than an effect on projectId, so clearing the project resets
  // Prepared By in the same event instead of a cascading effect render.
  const isTechnical = isTechnicalRole(currentUser.role);
  const usesProjectOnBehalf = isTechnical && !canActOnBehalf(currentUser.username) && !reviseId;
  const [projectOnBehalfOptions, setProjectOnBehalfOptions] = useState<TeamMemberOption[] | null>(null);
  const projectOnBehalfRequest = useRef(0);

  function applyProjectOnBehalf(options: TeamMemberOption[] | null) {
    const owner = options?.length === 2 ? options.find((o) => o.id !== currentUser.id) : undefined;
    setProjectOnBehalfOptions(owner ? options : null);
    setDetails((d) => {
      if (owner) return { ...d, ...preparedByFields(owner) };
      return d.preparedByUserId === currentUser.id ? d : { ...d, ...preparedByFields(currentUser) };
    });
  }

  function loadProjectOnBehalf(nextProjectId: string) {
    // Only the latest selection's response counts — switching projects
    // quickly mustn't let an earlier, slower answer default the wrong owner.
    const request = ++projectOnBehalfRequest.current;
    fetch(`/api/quotations/on-behalf-options?projectId=${encodeURIComponent(nextProjectId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TeamMemberOption[]) => {
        if (request === projectOnBehalfRequest.current) applyProjectOnBehalf(Array.isArray(data) ? data : null);
      })
      .catch(() => {
        if (request === projectOnBehalfRequest.current) applyProjectOnBehalf(null);
      });
  }

  function handleProjectOnBehalfChange(nextProjectId: string) {
    if (!usesProjectOnBehalf) return;
    if (nextProjectId) {
      loadProjectOnBehalf(nextProjectId);
      return;
    }
    projectOnBehalfRequest.current++; // drop any answer still in flight
    applyProjectOnBehalf(null);
  }

  // A ?projectId= deep link arrives already selected, with no onChange.
  useEffect(() => {
    if (usesProjectOnBehalf && projectId) loadProjectOnBehalf(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.error('Pick a product and configure it above before adding it to the quote.');
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
      preparedByUserId: details.preparedByUserId,
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
    const isRevision = !!revisingFrom;
    const url = isRevision ? `/api/quotations/${revisingFrom!.id}/revise` : '/api/quotations';
    const payload = isRevision ? { ...buildQuotationPayload(), reason: revisionReason } : buildQuotationPayload();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Server responded with ${response.status}`);
      }
      const record = await response.json();
      setDetails((d) => ({ ...d, quotationNumber: record.quotation_number }));
      setLogStatus({
        text: isRevision ? `Saved as revision ${record.quotation_number} (original ${revisingFrom!.quotationNumber} unchanged).` : `Saved to quotation log as ${record.quotation_number}.`,
        tone: 'success'
      });
      setSavedQuotation({ id: record.id, quotation_number: record.quotation_number });
      return record;
    } catch (error) {
      setLogStatus({
        text: error instanceof Error && isRevision ? error.message : 'Quotation record server not reachable — PDF generated locally but NOT logged.',
        tone: 'error'
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
      toast.error('Could not move this project to the Demo stage. Please try again.');
    } finally {
      setMovingToDemo(false);
    }
  }

  async function handleDownloadPdf() {
    if (revisingFrom && !revisionReason.trim()) {
      toast.error('Enter a reason for this revision before saving.');
      return;
    }
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
        totals: composition.totals,
        companyOverride: publicConfig
          ? { legalName: publicConfig.companyLegalName, addressLines: [publicConfig.addressLine1, publicConfig.addressLine2, publicConfig.addressLine3].filter(Boolean), contactEmail: publicConfig.contactEmail }
          : undefined,
        termsOverride: publicConfig?.quotationTerms
      });
    } catch (error) {
      toast.error('PDF library failed to load or generate. Check your internet connection and try again.');
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
    // The project stays selected across Start Over, so keep its sales-person
    // default too (see applyProjectOnBehalf).
    // A revision keeps the prepared-by it inherited — starting the products
    // over must not quietly reissue the quotation in the reviser's own name.
    const projectOwner = projectOnBehalfOptions?.find((o) => o.id !== currentUser.id);
    const keptPreparedBy = revisingFrom
      ? { preparedBy: details.preparedBy, preparedByPhone: details.preparedByPhone, preparedByEmail: details.preparedByEmail, preparedByUserId: details.preparedByUserId }
      : projectOwner ? preparedByFields(projectOwner) : {};
    setDetails({ ...defaultDetails(currentUser), ...keptPreparedBy });
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
    setWizardStep(0);
    setStepError('');
  }


  const isAv = domain === 'av';
  const showScaffolding = isAv && (avProjectType === 'standee' || avProjectType === 'led');

  return (
    <AppShell title="New Quotation" subtitle="Configure a product, add it to the quote, and generate a client-ready PDF.">
        <div className={styles.topBar}>
          <span className={`${styles.rolePill} ${ROLE_PILL_CLASS[currentUser.role] || styles.rolePillUser}`}>{ROLE_LABELS[currentUser.role] || currentUser.role}</span>
          {isPrivileged && (
            <Link className={historyStyles.button} href="/quotation-history" target="_blank" rel="noreferrer">
              Quotation History
            </Link>
          )}
        </div>
        {revisingFrom && (
          <div className={`${styles.sectionPanel} ${styles.revisionBanner}`}>
            <div className={styles.revisionBannerTitle}>
              Revising {revisingFrom.quotationNumber} — the original stays unchanged. Reconfigure the products below, then save to create a new version.
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="revisionReason">Reason for this revision (required)</label>
              <input
                id="revisionReason"
                className={styles.formControl}
                placeholder="e.g. Client requested a lower quantity, price renegotiated…"
                value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        <div className={historyStyles.wizardSteps}>
          {WIZARD_STEPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={`${historyStyles.wizardStep} ${i === wizardStep ? historyStyles.wizardStepActive : ''} ${i < wizardStep ? historyStyles.wizardStepDone : ''}`}
              onClick={() => i < wizardStep && setWizardStep(i)}
            >
              <span className={historyStyles.wizardStepCircle}>{i < wizardStep ? '✓' : s.icon}</span>
              <span className={historyStyles.wizardStepLabel}>{i + 1}. {s.label}</span>
            </button>
          ))}
        </div>

        {stepError && <div className={historyStyles.loginError}>{stepError}</div>}

        {wizardStep === 0 && (
          <div className={historyStyles.wizardCard}>
            <h2 className={historyStyles.wizardCardTitle}><Package size={22} /> Build the Quote</h2>
            <div className={historyStyles.wizardCardHint}>
              {quotationMode === 'custom'
                ? 'Add one or more custom line items below — no catalog product is required. You can still add standard products too, if this quote is a mix of both.'
                : 'Pick a product, configure it below, then add it to the quote. Repeat to add more products to the same quote.'}
            </div>

            <div className={`${styles.field} ${styles.fieldTight}`}>
              <label className={styles.label}>Create New Quotation</label>
              {/* Same segmented-pill toggle as Lead Capture / Inquiry's
                  Capture/Import/List switcher (historyStyles.modeToggle) —
                  reused here instead of raw radio inputs so this reads as
                  the same "pick a mode" control everywhere in the app. */}
              <div className={historyStyles.modeToggle} role="radiogroup" aria-label="Quotation type">
                <button
                  type="button"
                  role="radio"
                  aria-checked={quotationMode === 'standard'}
                  className={`${historyStyles.modeToggleBtn} ${quotationMode === 'standard' ? historyStyles.modeToggleBtnActive : ''}`}
                  onClick={() => setQuotationMode('standard')}
                >
                  Standard Product Quotation
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={quotationMode === 'custom'}
                  className={`${historyStyles.modeToggleBtn} ${quotationMode === 'custom' ? historyStyles.modeToggleBtnActive : ''}`}
                  onClick={() => setQuotationMode('custom')}
                >
                  Custom Product Quotation
                </button>
              </div>
            </div>

            <div className={styles.sectionPanel}>
              <div className={`${styles.row} ${styles.columns}`}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="projectSelect">Project</label>
                  <ProjectSelect
                    value={projectId}
                    placeholder="-- No project (client details below stay independent) --"
                    onChange={(next, project) => {
                      setProjectId(next);
                      if (project) {
                        // A project just made via "+ Add New Project" isn't in
                        // this list yet — upsert it so selectedProject resolves.
                        setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev.map((p) => (p.id === project.id ? project : p)) : [project, ...prev]));
                        setDetails((d) => ({
                          ...d,
                          clientName: project.client_name || d.clientName,
                          clientCompany: project.company || d.clientCompany,
                          clientEmail: project.email || d.clientEmail,
                          clientPhone: project.phone || d.clientPhone,
                          clientAddress: project.address || d.clientAddress
                        }));
                      }
                      handleProjectOnBehalfChange(next);
                    }}
                  />
                  {selectedProject && <div className={styles.small}>Stage: {PROJECT_STAGE_LABEL[selectedProject.stage]}</div>}
                </div>
              </div>
              {quotationMode === 'custom' ? (
                <details>
                  <summary className={styles.summaryToggle}>
                    + Also add Standard Product Quotation items (optional)
                  </summary>
                  <div className={`${styles.row} ${styles.columns} ${styles.rowSpacedTop}`}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="domainSelect">What are you quoting?</label>
                      <select id="domainSelect" className={styles.formControl} value={domain} onChange={(e) => handleDomainChange(e.target.value as DomainKey | '')}>
                        <option value="">-- Choose a product category --</option>
                        <option value="av">AV</option>
                        <option value="robotics">Robotics</option>
                        <option value="ai">AI Video Analytics (Video Management System)</option>
                        <option value="si">System Integration</option>
                        <option value="visitiq">VisitIQ VMS (Visitor Management System)</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="projectVertical">Client&apos;s industry (optional)</label>
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
                </details>
              ) : (
                <div className={`${styles.row} ${styles.columns}`}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="domainSelect">What are you quoting?</label>
                    <select id="domainSelect" className={styles.formControl} value={domain} onChange={(e) => handleDomainChange(e.target.value as DomainKey | '')}>
                      <option value="">-- Choose a product category --</option>
                      <option value="av">AV</option>
                      <option value="robotics">Robotics</option>
                      <option value="ai">AI Video Analytics (Video Management System)</option>
                      <option value="si">System Integration</option>
                      <option value="visitiq">VisitIQ VMS (Visitor Management System)</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="projectVertical">Client&apos;s industry (optional)</label>
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
              )}
            </div>

            {isAv && (
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="projectType">Product type</label>
                  <select id="projectType" className={styles.formControl} value={avProjectType} onChange={(e) => setAvProjectType(e.target.value as AvProjectType | '')}>
                    <option value="">-- Select product type --</option>
                    <option value="av-solution">AV Solution (suggest by room size)</option>
                    <option value="standee">Standee</option>
                    <option value="led">Active LED</option>
                    <option value="interactive-panel">Interactive Flat Panel</option>
                    <option value="conference">Conferencing Cameras &amp; Microphones</option>
                    <option value="cables">AV Cables</option>
                  </select>
                </div>
              </div>
            )}

            {((!domain) || (isAv && !avProjectType)) && (
              <div className={styles.sectionPanel}>
                <div className={styles.small}>
                  {!domain
                    ? 'Choose a product category above to start configuring a product for this quote.'
                    : 'Select a product type above to start configuring this product.'}
                </div>
              </div>
            )}

            {isAv && avProjectType === 'av-solution' && (
              <div className={styles.sectionPanel}>
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
                      onFocus={selectAllOnFocus}
                      onChange={(e) => setRoomSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Suggested for</label>
                    <div className={`${styles.small} ${styles.smallTopPad}`}>{roomSuggestions.tierLabel}</div>
                  </div>
                </div>
                <div className={`${styles.small} ${styles.smallBottomSpace}`}>
                  Tailored suggestions across every AV product category for this room size — click one to switch the product type and apply it. (Standees are lobby/signage kiosks, so they're not sized by seat count.)
                </div>
                {roomSuggestions.items.map((item) => (
                  <div key={item.avProjectType} className={styles.lineItemRow}>
                    <span className={styles.flexFill}>
                      <strong>{item.categoryLabel}:</strong> {item.modelLabel} — {item.reason}
                    </span>
                    <button type="button" className={historyStyles.button} onClick={() => applyRoomSuggestion(item)}>
                      Use this
                    </button>
                  </div>
                ))}
              </div>
            )}

            <StandeeEstimator key={`standee-${resetKey}`} active={isAv && avProjectType === 'standee'} costInputs={costInputs} onResultChange={setActiveResult} overrides={overrides} />
            <LedEstimator key={`led-${resetKey}`} active={isAv && avProjectType === 'led'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={ledPreset} overrides={overrides} />
            <ConferenceEstimator key={`conference-${resetKey}`} active={isAv && avProjectType === 'conference'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={conferencePreset} overrides={overrides} />
            <InteractivePanelEstimator key={`ifp-${resetKey}`} active={isAv && avProjectType === 'interactive-panel'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={interactivePanelPreset} overrides={overrides} />
            <CablesEstimator key={`cables-${resetKey}`} active={isAv && avProjectType === 'cables'} costInputs={costInputs} onResultChange={setActiveResult} presetModel={cablesPreset} overrides={overrides} />
            <RoboticsEstimator key={`robotics-${resetKey}`} active={domain === 'robotics'} onResultChange={setActiveResult} overrides={overrides} />
            <AiAnalyticsEstimator key={`ai-${resetKey}`} active={domain === 'ai'} onResultChange={setActiveResult} canEditPricing={canEditPricing} overrides={overrides} />
            <SiEstimator key={`si-${resetKey}`} active={domain === 'si'} onResultChange={setActiveResult} />
            <VisitIqEstimator key={`visitiq-${resetKey}`} active={domain === 'visitiq'} onResultChange={setActiveResult} overrides={overrides} />

            <h2 className={styles.h2}>Cost &amp; Add to Quote</h2>
            <div className={styles.sectionPanel}>
              <CostInputsSection
                costInputs={costInputs}
                onChange={(patch) => setCostInputs((c) => ({ ...c, ...patch }))}
                showInstallFabrication={isAv}
                showScaffolding={showScaffolding}
              />

              <CartList
                items={cartItems}
                hasActiveProduct={!!activeResult && activeResult.lineItems.length > 0}
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
                canEdit={canEditPricing}
              />

              <CustomProductsList
                products={customProducts}
                onAdd={() => setCustomProducts((prev) => [...prev, { id: nextId.current++, name: '', description: '', unit: '', qty: 1, price: 0, remarks: '' }])}
                onAddFromCatalog={(product) => setCustomProducts((prev) => [...prev, { id: nextId.current++, name: product.name, description: '', unit: '', qty: product.defaultQty || 1, price: product.sellingPrice, remarks: '' }])}
                onChangeItem={(id, patch) => setCustomProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))}
                onRemove={(id) => setCustomProducts((prev) => prev.filter((p) => p.id !== id))}
              />
            </div>
          </div>
        )}

        {wizardStep === 1 && (
          <div className={historyStyles.wizardCard}>
            <h2 className={historyStyles.wizardCardTitle}><User size={22} /> Client Details</h2>
            <div className={historyStyles.wizardCardHint}>Who is this quotation for?</div>
            <QuotationDetailsForm
              details={details}
              onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
              onBehalfOptions={onBehalfOptions ?? projectOnBehalfOptions ?? undefined}
              onBehalfHint={!onBehalfOptions && projectOnBehalfOptions ? TECHNICAL_ON_BEHALF_HINT : undefined}
            />
          </div>
        )}

        {wizardStep === 2 && (
          <div className={historyStyles.wizardCard}>
            <h2 className={historyStyles.wizardCardTitle}><Send size={22} /> Review &amp; Send</h2>
            <div className={historyStyles.wizardCardHint}>Check the total below, then save and download the client-ready PDF.</div>

            <div ref={summaryRef}>
              <SummaryPanel
                activeResult={activeResult}
                cartCount={cartItems.length}
                cartSubtotal={cartTotal}
                customProductsTotal={customProductsTotal}
                totals={composition.totals}
              />
            </div>

            <div className={`${styles.actions} ${styles.actionsSpaced}`}>
              <button type="button" className={styles.btn} disabled={pdfBusy} onClick={handleDownloadPdf}>
                {pdfBusy ? 'Working…' : 'Save & Download PDF'}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={handleReset}>
                Start Over
              </button>
            </div>
            {logStatus && (
              <div className={`${styles.small} ${logStatus.tone === 'success' ? styles.logStatusSuccess : styles.logStatusError}`}>
                {logStatus.text}
              </div>
            )}
            {savedQuotation && (
              <div className={`${styles.small} ${styles.savedQuotationRow}`}>
                {projectId ? (
                  <>
                    <span>
                      Project <Link href={`/projects/${projectId}`}>{projectId}</Link>
                      {selectedProject ? ` · Stage: ${PROJECT_STAGE_LABEL[selectedProject.stage]}` : ''}
                    </span>
                    {/* Technical staff can't create demo requests — the
                        project's sales owner moves it to Demo. */}
                    {!isTechnical && (
                      <button type="button" className={historyStyles.button} disabled={movingToDemo} onClick={handleMoveToDemo}>
                        {movingToDemo ? 'Moving…' : 'Move to Demo'}
                      </button>
                    )}
                  </>
                ) : (
                  <span>This quotation wasn&apos;t linked to a project — select one above next time to track it through the pipeline.</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className={historyStyles.wizardNav}>
          {wizardStep > 0 ? (
            <button type="button" className={historyStyles.bigBtnGhost} onClick={goBack}>← Back</button>
          ) : <span />}
          {wizardStep < WIZARD_STEPS.length - 1 && (
            <button type="button" className={historyStyles.bigBtn} onClick={goNext}>
              Next: {WIZARD_STEPS[wizardStep + 1].label} →
            </button>
          )}
        </div>
    </AppShell>
  );
}

export default function QuotationCalculator({ currentUser, canEditPricing, isPrivileged }: QuotationCalculatorProps) {
  return (
    <Suspense fallback={<div className={styles.page} />}>
      <QuotationCalculatorContent currentUser={currentUser} canEditPricing={canEditPricing} isPrivileged={isPrivileged} />
    </Suspense>
  );
}
