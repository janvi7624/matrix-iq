module.exports = (sequelize, DataTypes) => {
  // The channel-agnostic conversation store. WhatsApp will write here later
  // rather than getting a table of its own — hence `channel` and the
  // nullable-unique `external_id` (partial unique index, see the migration),
  // which is what makes a redelivered webhook idempotent.
  //
  // leads.notes / call_remark / meta_raw_field_data are read as CONTEXT by
  // the analysis assembler and never copied in here: copying would give one
  // sentence two homes, and they would drift the first time a note changed.
  const LeadInteraction = sequelize.define('LeadInteraction', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    lead_id: { type: DataTypes.UUID, allowNull: false },
    // 'manual_paste' | 'whatsapp' | 'email' | 'call' | 'web_form'
    channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual_paste' },
    // 'inbound' | 'outbound' | 'internal'
    direction: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'inbound' },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // Free text: an inbound author is usually not a MatrixIQ user.
    author: { type: DataTypes.STRING(120) },
    // Set only when the speaker IS a user.
    author_user_id: { type: DataTypes.UUID },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    external_id: { type: DataTypes.STRING(255) },
    language: { type: DataTypes.STRING(10), allowNull: false, defaultValue: '' },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'lead_interactions',
    underscored: true,
    paranoid: true
  });

  LeadInteraction.associate = (models) => {
    LeadInteraction.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    LeadInteraction.belongsTo(models.User, { foreignKey: 'author_user_id', as: 'authorUser' });
    LeadInteraction.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return LeadInteraction;
};
