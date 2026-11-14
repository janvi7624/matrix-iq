module.exports = (sequelize, DataTypes) => {
  // Approved company knowledge, per department. Only status 'approved' rows
  // are ever packed into a prompt — enforced in the store layer, not here.
  //
  // `search_tsv` (a STORED GENERATED tsvector, see migration
  // 20261114120000) is intentionally NOT declared: Sequelize would include
  // it in INSERT/UPDATE and Postgres rejects writes to a generated column.
  // The FTS fallback reads it through raw SQL instead.
  const KnowledgeEntry = sequelize.define('KnowledgeEntry', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    department_id: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // 'spec' | 'faq' | 'service' | 'pricing_rule' | 'policy' | 'brochure'
    kind: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'faq' },
    // 'draft' | 'approved' | 'archived'
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    effective_from: { type: DataTypes.DATEONLY },
    // Past this date the entry is stale: still sent, but labelled as
    // possibly outdated and surfaced in the admin list.
    review_by: { type: DataTypes.DATEONLY },
    owner_id: { type: DataTypes.UUID },
    approved_by_id: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    attachment_id: { type: DataTypes.UUID },
    // Flat { key -> value } for conflict detection. Hand-filled, so {} means
    // "nothing to compare", not "no conflicts".
    attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    token_estimate: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Staged for a later pgvector rollout — a float array here backfills
    // into a real vector(N) column, but cannot itself be searched.
    embedding_json: { type: DataTypes.JSONB },
    embedding_model: { type: DataTypes.STRING(60) },
    embedding_dim: { type: DataTypes.INTEGER },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'knowledge_entries',
    underscored: true,
    paranoid: true
  });

  KnowledgeEntry.associate = (models) => {
    KnowledgeEntry.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    KnowledgeEntry.belongsTo(models.User, { foreignKey: 'owner_id', as: 'owner' });
    KnowledgeEntry.belongsTo(models.User, { foreignKey: 'approved_by_id', as: 'approver' });
    KnowledgeEntry.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    KnowledgeEntry.belongsTo(models.Attachment, { foreignKey: 'attachment_id', as: 'attachment' });
  };

  return KnowledgeEntry;
};
