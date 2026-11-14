module.exports = (sequelize, DataTypes) => {
  // The explainable scoring table: signal -> operator -> weight. AI
  // extractions feed these rules; the model never sets the band itself.
  //
  // Band THRESHOLDS are not here — they live in appConfigStore, because
  // three numbers are configuration rather than rows.
  const LeadScoreRule = sequelize.define('LeadScoreRule', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING(60), allowNull: false },
    label: { type: DataTypes.STRING(160), allowNull: false, defaultValue: '' },
    // Which extracted field or lead condition this reads, e.g.
    // 'requirements.budget', 'intent', 'lead.contact'.
    //
    // There is deliberately NO volume signal: message count must never
    // raise a score.
    signal: { type: DataTypes.STRING(60), allowNull: false },
    // 'present' | 'absent' | 'gte' | 'lte' | 'equals' | 'in' | 'matches'
    operator: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'present' },
    comparand: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // May be negative (spam, no contact method).
    weight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // An extraction below this confidence contributes nothing, so a guess
    // cannot quietly become a score.
    min_confidence: { type: DataTypes.DECIMAL(4, 3), allowNull: false, defaultValue: 0.6 },
    // NULL means "every department", which is why the FK CASCADEs rather
    // than SET NULL — see the migration header.
    department_id: { type: DataTypes.UUID },
    status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'active' },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'lead_score_rules',
    underscored: true,
    paranoid: true
  });

  LeadScoreRule.associate = (models) => {
    LeadScoreRule.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    LeadScoreRule.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return LeadScoreRule;
};
