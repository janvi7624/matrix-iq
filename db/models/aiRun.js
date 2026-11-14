module.exports = (sequelize, DataTypes) => {
  // One row per provider call: audit, cost, and retention.
  //
  // paranoid: false on purpose. The retention purge
  // (/api/cron/ai-retention-purge) is a HARD delete — a soft-deleted audit
  // row still holding output_json and raw_prompt would defeat the point of
  // having a retention policy.
  const AiRun = sequelize.define('AiRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Nullable: eval runs have no lead. FK is SET NULL on delete so spend
    // history survives a lead being removed.
    lead_id: { type: DataTypes.UUID },
    // 'lead_analysis' | 'eval' | 'feedback_questions'
    purpose: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'lead_analysis' },
    provider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    model: { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' },
    prompt_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    // Provider-REPORTED counts. The char/4 heuristic is pre-flight only, for
    // deciding what fits the knowledge budget — never for billing.
    prompt_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    completion_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Computed from ai.pricing in appConfigStore — never a hard-coded rate.
    cost_usd: { type: DataTypes.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
    latency_ms: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // 'ok' | 'timeout' | 'provider_error' | 'schema_invalid' | 'refused' | 'no_key'
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ok' },
    error_message: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // Includes retries, so a degrading provider is visible in the log
    // instead of showing up as unexplained latency.
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // 'full_pack' | 'fts_fallback' — recorded because the day a department
    // outgrows its token budget, retrieval silently changes strategy.
    retrieval_mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'full_pack' },
    knowledge_entry_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    output_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // OFF by default (ai.storeRawPrompts). Holds customer text — the one
    // column here with real privacy weight.
    raw_prompt: { type: DataTypes.TEXT },
    triggered_by_id: { type: DataTypes.UUID },
    department_id: { type: DataTypes.UUID },
    // Stamped at INSERT from ai.retentionDays, not derived at purge time, so
    // shortening the policy never retroactively destroys history.
    retention_until: { type: DataTypes.DATEONLY, allowNull: false }
  }, {
    tableName: 'ai_runs',
    underscored: true,
    paranoid: false
  });

  AiRun.associate = (models) => {
    AiRun.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    AiRun.belongsTo(models.User, { foreignKey: 'triggered_by_id', as: 'triggeredBy' });
    AiRun.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
  };

  return AiRun;
};
