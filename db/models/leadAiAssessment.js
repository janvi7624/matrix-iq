module.exports = (sequelize, DataTypes) => {
  // What the AI concluded about one lead, and what a human then did about
  // it. History is kept; `is_current` marks the live one, enforced by a
  // partial unique index rather than by store discipline.
  const LeadAiAssessment = sequelize.define('LeadAiAssessment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    lead_id: { type: DataTypes.UUID, allowNull: false },
    // FK is SET NULL, never CASCADE: ai_runs is hard-purged on the 90-day
    // retention policy, and cascading would make that purge destroy the
    // lead's analysis history along with the call log.
    ai_run_id: { type: DataTypes.UUID },
    department_id: { type: DataTypes.UUID },
    summary: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // Per field: { value, confidence, source_quote }. The quote is what
    // makes an extraction checkable rather than merely assertive.
    requirements: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // 'enquiry' | 'price_request' | 'demo_request' | 'support' | 'spam'
    intent: { type: DataTypes.STRING(30), allowNull: false, defaultValue: '' },
    intent_confidence: { type: DataTypes.DECIMAL(4, 3), allowNull: false, defaultValue: 0 },
    suggested_department_id: { type: DataTypes.UUID },
    // A ROLE KEY from lib/roleStore.ts (Sales is the key `user`), never a
    // named person — routing to an individual is the reporting manager's
    // job, not the model's.
    suggested_owner_role: { type: DataTypes.STRING(40), allowNull: false, defaultValue: '' },
    next_best_action: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // A DRAFT. Nothing in this phase can send it; the panel is copy-only.
    suggested_reply: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // knowledge_entries.id[] actually shown to the model. Plain JSONB rather
    // than a join table because this is a point-in-time record of what the
    // model saw — it must NOT follow later edits to those entries.
    citations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // DEFAULT TRUE, deliberately: a row that failed to populate must read as
    // "a human is needed", never as "cleared".
    handoff_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    handoff_reason: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // 'hot' | 'warm' | 'cold' | 'unqualified'. Note 'cold', where
    // leads.priority says 'cool' — the mapping happens once, on Accept.
    score_band: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    score_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // [{ rule_key, label, points, matched_value, source_quote }]
    score_reasons: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    rules_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // Duplicated from the run so the row stays self-describing once its
    // ai_runs row has been purged.
    prompt_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    provider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    model: { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    accepted_at: { type: DataTypes.DATE },
    accepted_by_id: { type: DataTypes.UUID },
    // Which field names the human actually took, so partial acceptance is
    // distinguishable from wholesale acceptance in the eval feedback.
    accepted_fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // '' | 'used' | 'rejected' — the reply-quality feedback signal.
    reply_outcome: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    reply_outcome_at: { type: DataTypes.DATE },
    reply_outcome_by_id: { type: DataTypes.UUID },
    // Manual band override. There is no lead_score_overrides table on
    // purpose: the effective value lives on leads.priority, the latest
    // verdict here, and the history in audit_logs via logAudit.
    override_band: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    // Full text — audit_logs.remarks is truncated to 255 by fit() in
    // lib/auditLogStore.ts, so the untruncated reason has to live here.
    override_reason: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    override_by_id: { type: DataTypes.UUID },
    override_at: { type: DataTypes.DATE }
  }, {
    tableName: 'lead_ai_assessments',
    underscored: true,
    paranoid: true
  });

  LeadAiAssessment.associate = (models) => {
    LeadAiAssessment.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    LeadAiAssessment.belongsTo(models.AiRun, { foreignKey: 'ai_run_id', as: 'run' });
    LeadAiAssessment.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    LeadAiAssessment.belongsTo(models.Department, { foreignKey: 'suggested_department_id', as: 'suggestedDepartment' });
    LeadAiAssessment.belongsTo(models.User, { foreignKey: 'accepted_by_id', as: 'acceptedBy' });
    LeadAiAssessment.belongsTo(models.User, { foreignKey: 'reply_outcome_by_id', as: 'replyOutcomeBy' });
    LeadAiAssessment.belongsTo(models.User, { foreignKey: 'override_by_id', as: 'overriddenBy' });
  };

  return LeadAiAssessment;
};
