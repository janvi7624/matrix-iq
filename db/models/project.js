module.exports = (sequelize, DataTypes) => {
  const Project = sequelize.define('Project', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // The primary "Client Representative Name" — see lib/types.ts's
    // ProjectRecord comment.
    client_name: { type: DataTypes.STRING },
    company: { type: DataTypes.STRING },
    // Optional alternate contact's name (paired with alt_contact_phone
    // below) — no longer a primary field, kept under its original column
    // name to avoid a data-moving rename.
    contact_person: { type: DataTypes.STRING },
    alt_contact_phone: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    // Free text — team rosters aren't real accounts per app comment, no FK.
    sales_person: { type: DataTypes.STRING },
    source: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('active', 'on_hold', 'won', 'lost'), allowNull: false, defaultValue: 'active' },
    // Set the moment status flips to 'won'/'lost', cleared on reopen — see
    // lib/projectStore.ts. Drives the Projects list's 90-day auto-hide.
    closed_at: { type: DataTypes.DATE },
    stage: {
      type: DataTypes.ENUM(
        'cold_call', 'catalogue_offered', 'site_visit', 'quotation', 'demo', 'customer_response', 'negotiation',
        'po_received', 'installation', 'completed', 'closed_lost'
      ),
      allowNull: false,
      defaultValue: 'cold_call'
    },
    // Cold Call stage's own sub-detail — see lib/types.ts's ProjectRecord comment.
    cold_call_responded: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
    expected_closing_date: { type: DataTypes.DATEONLY },
    next_follow_up_date: { type: DataTypes.DATEONLY },
    remarks: { type: DataTypes.TEXT },
    // The sales person's own gut-feel estimate (0-100) of the chance this
    // project closes — set at creation, editable later. Null = no estimate
    // given. See lib/projectStore.ts's FIELDS (kind 'nullable').
    // SUPERSEDED as a stored value. Closing % is now DERIVED from the stage
    // on every read (lib/projectStore.ts normalizeProject ->
    // lib/salesStageRules.ts resolveClosingPercent), because a stored
    // percentage drifting from the stage it claims to describe IS the defect
    // this was changed to fix. Nothing writes this column any more; the
    // hand-typed history it used to hold was copied to
    // legacy_closing_percent by migration 20261016120000. Read the derived
    // value, never this.
    closing_probability_percent: { type: DataTypes.INTEGER },
    // The hand-typed figures as they stood before Closing % became derived.
    // Null is meaningful and preserved: 100 of 185 live projects never had
    // an estimate at all.
    legacy_closing_percent: { type: DataTypes.INTEGER },
    // An admin's manual figure, which outranks the stage's standard one but
    // NOT a won/lost outcome, and which any stage change discards. The
    // reason is mandatory at the API; it cannot be NOT NULL here because
    // every existing row has no override.
    closing_percent_override: { type: DataTypes.INTEGER },
    closing_percent_override_reason: { type: DataTypes.TEXT },
    // Denormalised actor/time so the dashboard can mark an overridden row
    // without joining audit_logs per row. audit_logs remains the real trail.
    closing_percent_override_by: { type: DataTypes.UUID },
    closing_percent_override_at: { type: DataTypes.DATE },
    // Commit gate: when the PO is expected, and who at the customer
    // verbally confirmed it.
    expected_po_date: { type: DataTypes.DATEONLY },
    confirmed_by_contact: { type: DataTypes.STRING },
    // Lost gate. A plain string rather than an enum, following
    // cold_call_responded's own stated reasoning in this file: a short
    // vocabulary that may grow is not worth an ALTER TYPE each time. The
    // allowed values live in lib/salesStageRules.ts (LOST_REASONS) and are
    // enforced on every write.
    lost_reason: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    // Quotation gate. Auto-filled from the newest linked quotation when the
    // project has one (Project hasMany Quotation, with revisions), typed in
    // when the quote went out from outside the app — which is the common
    // case: only 19 of 185 projects have a quotation record.
    quote_value: { type: DataTypes.DECIMAL(14, 2) },
    quotation_date: { type: DataTypes.DATEONLY },
    // When this project entered the stage it is in now — maintained by
    // lib/projectStore.ts on every stage change, because the timeline
    // cannot be asked (its `stage` is stamped on every event, not only on
    // moves). Backfilled by migration 20261016120100 as the start of the
    // most recent contiguous run in the current stage, falling back to
    // created_at for the 118 projects that never moved.
    stage_entered_at: { type: DataTypes.DATE },
    // Mandatory on manual creation (enforced in app/api/projects/route.ts,
    // not here) — nullable at the DB level since an auto-created-from-lead
    // project deliberately starts without one (see lib/leadProjectAutomation.ts;
    // a Lead's own value is unstructured free text, never guess-parsed into
    // a real money field).
    approx_price: { type: DataTypes.DECIMAL(14, 2) },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // ProjectStage values this project has been marked as not needing — e.g.
    // Site Visit when the demo was given virtually.
    skipped_stages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Delivery department(s) this project belongs to — 'ai' | 'av' |
    // 'robotics', see lib/projectDepartmentOptions.ts. A list, so a deal
    // spanning two departments holds both; empty on projects predating it.
    departments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // How much of approx_price belongs to each of those departments, e.g.
    // { "ai": 2700000, "av": 2300000 } on a 50L deal. Empty for a
    // single-department project, which has nothing to divide.
    department_amounts: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_by: { type: DataTypes.UUID },
    // Project Lead / Mentor — see lib/projectLeadOptions.ts. Mandatory going
    // forward (enforced in the API, not here); NULL on older projects.
    project_lead_id: { type: DataTypes.UUID },
    // 'distribution' | 'project' — drives the Project Lead's default; see
    // lib/projectLeadOptions.ts. NULL on older projects.
    opportunity_type: { type: DataTypes.STRING(20) },
    // Intake fields — see the 20260929120000-project-intake-fields migration.
    project_name: { type: DataTypes.STRING(255) },
    state: { type: DataTypes.STRING(120) },
    city: { type: DataTypes.STRING(120) },
    referral_name: { type: DataTypes.STRING(255) },
    tender_capex: { type: DataTypes.DECIMAL(14, 2) },
    tender_opex: { type: DataTypes.DECIMAL(14, 2) },
    tender_ref_number: { type: DataTypes.STRING(120) },
    tender_name: { type: DataTypes.STRING(255) },
    tender_deadline: { type: DataTypes.DATEONLY },
    tender_estimated_value: { type: DataTypes.DECIMAL(14, 2) },
    tender_pbg: { type: DataTypes.STRING(255) },
    tender_emd: { type: DataTypes.DECIMAL(14, 2) },
    payment_terms: { type: DataTypes.TEXT },
    assigned_technical_person_id: { type: DataTypes.UUID },
    // Set the first time a technical person is assigned — see
    // lib/tmsHandoff.ts. Links this Sales project to the TMS project
    // auto-created (or kept in sync) for whoever is actually doing the work.
    tms_project_id: { type: DataTypes.UUID },
    // Lead -> Project automation overlay — NULL for every normal project;
    // only set on one auto-created from an assigned Lead
    // (lib/leadProjectAutomation.ts). `status` itself is never touched by
    // this feature. Values: 'pending_confirmation' | 'confirmed'.
    // Partner Portal overlay — NULL on every direct project. See the
    // 20261020093000 migration for why this is an overlay on `projects`
    // rather than a separate submissions table.
    partner_id: { type: DataTypes.UUID },
    // 'submitted' | 'info_requested' | 'approved' | 'rejected'
    partner_submission_status: { type: DataTypes.STRING(30) },
    partner_reviewed_by: { type: DataTypes.UUID },
    partner_reviewed_at: { type: DataTypes.DATE },
    partner_review_remarks: { type: DataTypes.TEXT },
    // The partner's own estimate — deliberately NOT approx_price, which
    // feeds the sales forecast and is set by Sales on acceptance.
    partner_submitted_value: { type: DataTypes.DECIMAL(14, 2) },
    partner_expected_timeline: { type: DataTypes.STRING(120) },
    lead_confirmation_status: { type: DataTypes.STRING(30) },
    confirmed_by: { type: DataTypes.UUID },
    confirmed_at: { type: DataTypes.DATE }
  }, {
    tableName: 'projects',
    underscored: true,
    paranoid: true
  });

  Project.associate = (models) => {
    Project.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Project.belongsTo(models.User, { foreignKey: 'assigned_technical_person_id', as: 'assignedTechnicalPersonRef' });
    Project.belongsTo(models.User, { foreignKey: 'project_lead_id', as: 'projectLeadRef' });
    Project.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'tmsProject' });
    Project.belongsTo(models.Partner, { foreignKey: 'partner_id', as: 'partner' });
    Project.belongsTo(models.User, { foreignKey: 'partner_reviewed_by', as: 'partnerReviewer' });
    Project.hasMany(models.ProjectNote, { foreignKey: 'project_id', as: 'notes' });
    Project.hasMany(models.ProjectTimelineEvent, { foreignKey: 'project_id', as: 'timeline' });
    Project.hasMany(models.ProjectDeadlineExtension, { foreignKey: 'project_id', as: 'deadlineExtensions' });
    Project.hasMany(models.Lead, { foreignKey: 'project_id', as: 'leads' });
    Project.hasMany(models.SiteVisit, { foreignKey: 'project_id', as: 'siteVisits' });
    Project.hasMany(models.Quotation, { foreignKey: 'project_id', as: 'quotations' });
    Project.hasMany(models.DemoSchedule, { foreignKey: 'project_id', as: 'demoSchedules' });
    Project.hasMany(models.CustomerResponse, { foreignKey: 'project_id', as: 'customerResponses' });
    Project.hasMany(models.Negotiation, { foreignKey: 'project_id', as: 'negotiations' });
    Project.hasMany(models.PurchaseOrder, { foreignKey: 'project_id', as: 'purchaseOrders' });
    Project.hasMany(models.Installation, { foreignKey: 'project_id', as: 'installations' });
    Project.hasMany(models.DeliveryChallan, { foreignKey: 'project_id', as: 'deliveryChallans' });
    Project.hasMany(models.MarketingRequest, { foreignKey: 'project_id', as: 'marketingRequests' });
  };

  return Project;
};
