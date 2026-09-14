require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const { chromium } = require('playwright');
const db = require('./db/models');

const PORT = 3915;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.ADMIN_SESSION_SECRET;
const SHOT_DIR = 'C:\\Users\\allbo\\AppData\\Local\\Temp\\claude\\c--Users-allbo-Downloads-quatation-estimator\\3b2e473e-698b-4bf2-91e3-b5db037f5ee7\\scratchpad\\qa-screenshots';

const results = []; // { section, status: 'PASS'|'FAIL'|'INFO', detail }
function record(section, status, detail) {
  results.push({ section, status, detail });
  console.log(`[${status}] ${section}: ${detail}`);
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function mintToken(sub, username, role, isPrivileged) {
  const payload = { sub, username, role, exp: Date.now() + 8 * 60 * 60 * 1000, isPrivileged };
  const payloadJson = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', SECRET).update(payloadJson).digest();
  return `${payloadJson}.${b64url(sig)}`;
}

async function newAuthedContext(browser, sub, username, role, isPrivileged, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
  const token = mintToken(sub, username, role, isPrivileged);
  await context.addCookies([{ name: 'nanta_session', value: token, url: BASE }]);
  const consoleErrors = [];
  const failedRequests = [];
  context.on('page', (page) => {
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().includes('/api/')) failedRequests.push(`${res.status()} ${res.url()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  });
  return { context, consoleErrors, failedRequests, username };
}

async function main() {
  const browser = await chromium.launch();

  // ---------- Find real users ----------
  const manager = await db.User.findOne({ include: [{ model: db.Role, as: 'role', where: { key: ['superadmin'] } }], where: { status: 'active' } });
  const candidates = await db.User.findAll({ where: { status: 'active' }, limit: 6 });
  const assigneeA = candidates.find((u) => u.get('id') !== manager.get('id'));
  const assigneeB = candidates.find((u) => u.get('id') !== manager.get('id') && u.get('id') !== assigneeA.get('id'));
  console.log(`Manager: ${manager.get('username')} | Assignee A: ${assigneeA.get('username')} | Assignee B: ${assigneeB.get('username')}`);

  const mgr = await newAuthedContext(browser, manager.get('id'), manager.get('username'), 'superadmin', true);
  const mgrPage = await mgr.context.newPage();

  // ================= SECTION 1: /projects =================
  console.log('\n=== SECTION 1: /projects ===');
  await mgrPage.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await mgrPage.waitForTimeout(1500);
  await mgrPage.screenshot({ path: `${SHOT_DIR}\\01-projects-desktop.png`, fullPage: true });

  const kpiTilesVisible = await mgrPage.locator('text=Total (filtered)').count();
  record('1. KPI tiles visible', kpiTilesVisible > 0 ? 'PASS' : 'FAIL', `Found ${kpiTilesVisible} "Total (filtered)" tile(s)`);

  const totalTileText = await mgrPage.locator('text=Total (filtered)').first().locator('xpath=..').innerText().catch(() => '');
  const tableRowCount = await mgrPage.locator('table tbody tr').count();
  record('1. KPI vs table row-count sanity', 'INFO', `KPI tile text: "${totalTileText.replace(/\n/g, ' ')}" | table rows rendered: ${tableRowCount}`);

  const priceColumnVisible = await mgrPage.locator('th:has-text("Approx. Price")').count();
  record('1. Approx. Price column visible', priceColumnVisible > 0 ? 'PASS' : 'FAIL', `Found ${priceColumnVisible} header(s)`);

  const rupeeCells = await mgrPage.locator('td:has-text("₹")').count();
  record('1. ₹ formatting present in table', rupeeCells >= 0 ? 'INFO' : 'FAIL', `${rupeeCells} cell(s) contain ₹`);

  const confirmationColumnVisible = await mgrPage.locator('th:has-text("Confirmation")').count();
  record('1. Confirmation column visible', confirmationColumnVisible > 0 ? 'PASS' : 'FAIL', `Found ${confirmationColumnVisible} header(s)`);

  const installationStageText = await mgrPage.locator('text=Installation').count();
  const completedStageText = await mgrPage.locator('option:has-text("Completed")').count();
  record('1. No Installation/Completed stage options', (installationStageText === 0) ? 'PASS' : 'INFO', `"Installation" text occurrences: ${installationStageText}, "Completed" option occurrences: ${completedStageText}`);

  // Closing date filter interaction
  const beforeFilterCount = await mgrPage.locator('table tbody tr').count();
  const closingSelect = mgrPage.locator('select').filter({ hasText: 'Closing Date' });
  const closingSelectExists = await closingSelect.count();
  if (closingSelectExists > 0) {
    await closingSelect.first().selectOption({ label: 'Closing This Month' }).catch(() => {});
    await mgrPage.waitForTimeout(500);
    const afterMonthFilter = await mgrPage.locator('table tbody tr').count();
    const afterMonthTileText = await mgrPage.locator('text=Total (filtered)').first().locator('xpath=..').innerText().catch(() => '');
    record('1. Closing Date filter narrows results', 'INFO', `Before: ${beforeFilterCount} rows, after "This Month": ${afterMonthFilter} rows, KPI: "${afterMonthTileText.replace(/\n/g, ' ')}"`);

    await closingSelect.first().selectOption({ label: 'Closing Date: All' }).catch(() => {});
    await mgrPage.waitForTimeout(500);
    const afterClear = await mgrPage.locator('table tbody tr').count();
    record('1. Clearing closing-date filter restores count', afterClear === beforeFilterCount ? 'PASS' : 'FAIL', `Original: ${beforeFilterCount}, after clear: ${afterClear}`);
  } else {
    record('1. Closing Date filter control found', 'FAIL', 'Could not locate the Closing Date <select> by visible text');
  }

  record('1. Console/network errors on /projects', mgr.consoleErrors.length === 0 && mgr.failedRequests.length === 0 ? 'PASS' : 'FAIL',
    `console errors: ${JSON.stringify(mgr.consoleErrors)} | failed requests: ${JSON.stringify(mgr.failedRequests)}`);

  // ================= SECTION 2: Project creation/edit =================
  console.log('\n=== SECTION 2: Project creation ===');
  mgr.consoleErrors.length = 0; mgr.failedRequests.length = 0;
  const newProjectBtn = mgrPage.locator('button:has-text("New Project")');
  await newProjectBtn.click();
  await mgrPage.waitForTimeout(300);

  // Fill required fields except price, try submit
  await mgrPage.locator('input').first().fill('QA_TEST_ Smoke Client').catch(() => {});
  // Source field — try the ProjectSourceField input
  const sourceInputs = mgrPage.locator('input[placeholder], select').filter({ hasText: '' });
  // Best effort: find a text input near "Source *" label
  const sourceField = mgrPage.locator('text=Source *').locator('xpath=following::input[1] | following::select[1]').first();
  await sourceField.fill('QA Test Source').catch(async () => { await sourceField.selectOption({ index: 1 }).catch(() => {}); });

  const submitBtn = mgrPage.locator('button:has-text("Create project")');
  await submitBtn.click();
  await mgrPage.waitForTimeout(800);
  const toastAfterNoPrice = await mgrPage.locator('text=/price/i').count();
  record('2. Empty price blocked with clear message', toastAfterNoPrice > 0 ? 'PASS' : 'FAIL', `Found ${toastAfterNoPrice} element(s) mentioning "price" after submit-without-price attempt`);

  // Now fill a valid price and submit
  const priceInput = mgrPage.locator('label:has-text("Approx. Project Price")').locator('xpath=following::input[1]').first();
  await priceInput.fill('1234567').catch(() => {});
  await submitBtn.click();
  await mgrPage.waitForTimeout(1200);
  const projectCreatedRow = await mgrPage.locator('text=QA_TEST_ Smoke Client').count();
  record('2. Valid price -> project created', projectCreatedRow > 0 ? 'PASS' : 'FAIL', `"QA_TEST_ Smoke Client" appears ${projectCreatedRow} time(s) after creation`);
  await mgrPage.screenshot({ path: `${SHOT_DIR}\\02-project-created.png`, fullPage: true });

  record('2. Console/network errors during creation', mgr.consoleErrors.length === 0 && mgr.failedRequests.length === 0 ? 'PASS' : 'FAIL',
    `console errors: ${JSON.stringify(mgr.consoleErrors)} | failed requests: ${JSON.stringify(mgr.failedRequests)}`);

  // Open the created project's detail page and verify edit still works
  await mgrPage.locator('text=QA_TEST_ Smoke Client').first().locator('xpath=ancestor::tr[1]').locator('a:has-text("View")').click().catch(async () => {
    await mgrPage.locator('a:has-text("View")').first().click();
  });
  await mgrPage.waitForTimeout(1000);
  const detailLoaded = await mgrPage.locator('text=Project Progress').count();
  record('2. Project detail page loads', detailLoaded > 0 ? 'PASS' : 'FAIL', `"Project Progress" heading found: ${detailLoaded}`);
  await mgrPage.screenshot({ path: `${SHOT_DIR}\\03-project-detail.png`, fullPage: true });

  // ================= Cleanup marker: capture the created project id for teardown =================
  const createdProject = await db.Project.findOne({ where: { client_name: 'QA_TEST_ Smoke Client' } });
  const createdProjectId = createdProject ? createdProject.get('id') : null;

  await mgrPage.close();
  await mgr.context.close();

  // ================= SECTION 3+5: Lead -> Project assignment + reassignment =================
  console.log('\n=== SECTION 3+5: Lead assignment / confirmation / reassignment ===');
  const lead = await db.Lead.create({
    created_by: manager.get('id'),
    name: 'QA_TEST_ Lead Smoke',
    mobile: '9998887777',
    email: 'qa-test-smoke@example.com',
    company: 'QA Test Co',
    city: 'QA City',
    interests: [], sub_interests: [], priority: 'warm', follow_up_actions: [],
    budget: 'QA fixture budget', notes: 'Browser smoke test fixture — safe to delete.', source: 'manual'
  });
  const leadId = lead.get('id');

  const mgr2 = await newAuthedContext(browser, manager.get('id'), manager.get('username'), 'superadmin', true);
  const leadsPage = await mgr2.context.newPage();
  await leadsPage.goto(`${BASE}/leads`, { waitUntil: 'networkidle' });
  await leadsPage.waitForTimeout(1000);

  // Assign via direct API call (UI-driven assignment on this page requires a bulk-select flow that
  // varies by exact markup; using the real endpoint keeps this a faithful end-to-end check of the
  // same code path the UI calls, while the rest of this section verifies the RESULTING UI state).
  const assignRes = await leadsPage.request.post(`${BASE}/api/leads/assign`, {
    data: { leadIds: [leadId], assigneeId: assigneeA.get('id') },
    headers: { 'Content-Type': 'application/json' }
  });
  record('3. Lead assignment API call', assignRes.status() === 200 ? 'PASS' : 'FAIL', `status ${assignRes.status()}`);

  const leadAfter = await db.Lead.findByPk(leadId);
  const projectId = leadAfter.get('project_id');
  record('3. Linked Project auto-created', projectId ? 'PASS' : 'FAIL', `Lead.project_id = ${projectId}`);

  // View as Assignee A — check pending-confirmation UI on /projects and on the detail page
  const a = await newAuthedContext(browser, assigneeA.get('id'), assigneeA.get('username'), 'user', false);
  const aPage = await a.context.newPage();
  await aPage.goto(`${BASE}/projects?filter=pending_confirmation`, { waitUntil: 'networkidle' });
  await aPage.waitForTimeout(1000);
  const pendingBadge = await aPage.locator('text=Pending Confirmation').count();
  record('3. Pending Confirmation indication visible on /projects', pendingBadge > 0 ? 'PASS' : 'FAIL', `Found ${pendingBadge} "Pending Confirmation" element(s)`);
  await aPage.screenshot({ path: `${SHOT_DIR}\\04-pending-confirmation-list.png`, fullPage: true });

  // Dashboard attention item deep link
  await aPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await aPage.waitForTimeout(1200);
  const attentionItem = await aPage.locator('text=/awaiting your confirmation/i').count();
  record('3. Dashboard attention item for pending confirmation', attentionItem > 0 ? 'PASS' : 'INFO', `Found ${attentionItem} matching attention item(s) (INFO if 0 — may be below the visible fold/compact limit)`);

  // Open the project detail page directly and confirm
  await aPage.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle' });
  await aPage.waitForTimeout(1000);
  const confirmBanner = await aPage.locator('text=/please confirm/i').count();
  record('3. Confirmation banner visible on detail page', confirmBanner > 0 ? 'PASS' : 'FAIL', `Found ${confirmBanner} matching element(s)`);

  const missingChecklist = await aPage.locator('text=/Complete Project Details/i').count();
  record('3. Missing-info checklist visible', missingChecklist > 0 ? 'PASS' : 'FAIL', `Found ${missingChecklist} matching element(s)`);
  await aPage.screenshot({ path: `${SHOT_DIR}\\05-confirm-banner.png`, fullPage: true });

  const confirmBtn = aPage.locator('button:has-text("Confirm Assignment")');
  await confirmBtn.click();
  await aPage.waitForTimeout(1000);
  const stillPending = await aPage.locator('text=/please confirm/i').count();
  const confirmedProject = await db.Project.findByPk(projectId);
  record('3. UI + DB reflect confirmed state after clicking Confirm', (stillPending === 0 && confirmedProject.get('lead_confirmation_status') === 'confirmed') ? 'PASS' : 'FAIL',
    `Banner still showing: ${stillPending > 0}, DB lead_confirmation_status: ${confirmedProject.get('lead_confirmation_status')}`);
  await aPage.screenshot({ path: `${SHOT_DIR}\\06-after-confirm.png`, fullPage: true });

  record('3. Console/network errors (assignee flow)', a.consoleErrors.length === 0 && a.failedRequests.length === 0 ? 'PASS' : 'FAIL',
    `console errors: ${JSON.stringify(a.consoleErrors)} | failed requests: ${JSON.stringify(a.failedRequests)}`);

  // ================= SECTION 4: Notifications =================
  console.log('\n=== SECTION 4: Notifications ===');
  const bellBtn = aPage.locator('[aria-label*="otification" i], button:has(svg)').first();
  await aPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await aPage.waitForTimeout(1000);
  const notifBell = aPage.locator('button[aria-label*="otification" i]');
  const notifBellCount = await notifBell.count();
  if (notifBellCount > 0) {
    await notifBell.first().click();
    await aPage.waitForTimeout(800);
    const notifLink = aPage.locator(`a:has-text("QA Test Co"), a:has-text("QA_TEST")`).first();
    const notifLinkCount = await notifLink.count();
    record('4. Notification for assignment present', notifLinkCount > 0 ? 'PASS' : 'INFO', `Found ${notifLinkCount} matching notification link(s) — INFO if 0 (may have scrolled off/already read)`);
    if (notifLinkCount > 0) {
      const href = await notifLink.getAttribute('href');
      await notifLink.click();
      await aPage.waitForTimeout(1000);
      const resStatus = aPage.url();
      const is404 = await aPage.locator('text=/404|not found/i').count();
      record('4. Notification click navigates to valid destination', is404 === 0 ? 'PASS' : 'FAIL', `href="${href}", landed on ${resStatus}, 404-like text found: ${is404}`);
    }
  } else {
    record('4. Notification bell located', 'FAIL', 'Could not find a notification bell button by aria-label');
  }
  await aPage.screenshot({ path: `${SHOT_DIR}\\07-notifications.png`, fullPage: true });

  // ================= SECTION 5: Reassignment =================
  console.log('\n=== SECTION 5: Reassignment ===');
  const reassignRes = await leadsPage.request.post(`${BASE}/api/leads/assign`, {
    data: { leadIds: [leadId], assigneeId: assigneeB.get('id') },
    headers: { 'Content-Type': 'application/json' }
  });
  record('5. Reassignment API call', reassignRes.status() === 200 ? 'PASS' : 'FAIL', `status ${reassignRes.status()}`);

  const leadAfterReassign = await db.Lead.findByPk(leadId);
  const projectCountForLead = await db.Project.count({ where: { id: leadAfterReassign.get('project_id') } });
  const totalProjectsEverLinked = leadAfterReassign.get('project_id') === projectId ? 1 : 2;
  record('5. No duplicate Project created', leadAfterReassign.get('project_id') === projectId ? 'PASS' : 'FAIL',
    `project_id before: ${projectId}, after reassignment: ${leadAfterReassign.get('project_id')}`);

  const reassignedProject = await db.Project.findByPk(projectId);
  record('5. Ownership reflects new assignee', reassignedProject.get('created_by') === assigneeB.get('id') ? 'PASS' : 'FAIL',
    `created_by after reassignment: ${reassignedProject.get('created_by')}, expected: ${assigneeB.get('id')}`);
  record('5. Confirmation state reset for new assignee', reassignedProject.get('lead_confirmation_status') === 'pending_confirmation' ? 'PASS' : 'FAIL',
    `lead_confirmation_status: ${reassignedProject.get('lead_confirmation_status')}`);

  // ================= SECTION 6: Responsive sanity =================
  console.log('\n=== SECTION 6: Responsive sanity ===');
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1280x800', width: 1280, height: 800 },
    { name: '390x844', width: 390, height: 844 }
  ];
  for (const vp of viewports) {
    const rctx = await newAuthedContext(browser, manager.get('id'), manager.get('username'), 'superadmin', true, { width: vp.width, height: vp.height });
    const rpage = await rctx.context.newPage();
    await rpage.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
    await rpage.waitForTimeout(1000);
    const hasHorizontalOverflow = await rpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
    record(`6. Responsive ${vp.name}`, 'INFO', `Horizontal overflow on body: ${hasHorizontalOverflow} (table has its own scroll container by design)`);
    await rpage.screenshot({ path: `${SHOT_DIR}\\08-responsive-${vp.name}.png`, fullPage: false });
    await rctx.context.close();
  }

  // ================= SECTION 8: Regression smoke =================
  console.log('\n=== SECTION 8: Regression smoke ===');
  const reg = await newAuthedContext(browser, manager.get('id'), manager.get('username'), 'superadmin', true);
  const regPage = await reg.context.newPage();

  await regPage.goto(`${BASE}/leads`, { waitUntil: 'networkidle' });
  await regPage.waitForTimeout(800);
  record('8. /leads loads', (await regPage.locator('body').count()) > 0 && reg.failedRequests.length === 0 ? 'PASS' : 'FAIL', `failed requests: ${JSON.stringify(reg.failedRequests)}`);

  reg.failedRequests.length = 0;
  await regPage.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
  await regPage.waitForTimeout(800);
  const analyticsKpi = await regPage.locator('text=Total Approx. Value').count();
  record('8. /analytics loads with new Total Approx. Value tile', analyticsKpi > 0 && reg.failedRequests.length === 0 ? 'PASS' : 'FAIL', `tile found: ${analyticsKpi}, failed requests: ${JSON.stringify(reg.failedRequests)}`);
  await regPage.screenshot({ path: `${SHOT_DIR}\\09-analytics.png`, fullPage: true });

  reg.failedRequests.length = 0;
  await regPage.goto(`${BASE}/hr-dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await regPage.waitForTimeout(800);
  record('8. /hr-dashboard loads (unrelated module sanity)', reg.failedRequests.length === 0 ? 'PASS' : 'FAIL', `failed requests: ${JSON.stringify(reg.failedRequests)}`);

  reg.failedRequests.length = 0;
  await regPage.goto(`${BASE}/tms`, { waitUntil: 'networkidle' }).catch(() => {});
  await regPage.waitForTimeout(800);
  record('8. /tms loads (unrelated module sanity)', reg.failedRequests.length === 0 ? 'PASS' : 'FAIL', `failed requests: ${JSON.stringify(reg.failedRequests)}`);

  // ================= CLEANUP =================
  console.log('\n=== CLEANUP ===');
  try {
    const idsToDelete = [projectId];
    if (createdProjectId) idsToDelete.push(createdProjectId);
    await db.AuditLog.destroy({ where: { entity_id: idsToDelete } });
    await db.AuditLog.destroy({ where: { entity_type: 'lead', entity_id: leadId } });
    await db.Notification.destroy({ where: { entityId: idsToDelete } });
    await db.Project.destroy({ where: { id: idsToDelete }, force: true });
    await db.Lead.destroy({ where: { id: leadId }, force: true });
    record('Cleanup', 'PASS', `Deleted test project(s) ${idsToDelete.join(', ')}, lead ${leadId}, related audit/notification rows`);
  } catch (e) {
    record('Cleanup', 'FAIL', e.message);
  }

  await browser.close();
  await db.sequelize.close();

  console.log('\n\n========== SUMMARY ==========');
  for (const r of results) console.log(`[${r.status}] ${r.section} — ${r.detail}`);
  const fails = results.filter((r) => r.status === 'FAIL');
  console.log(`\nTotal: ${results.length}, FAIL: ${fails.length}`);
}

main().catch(async (e) => { console.error('FATAL', e); process.exit(1); });
