module.exports = (sequelize, DataTypes) => {
  const MetaWebhookEvent = sequelize.define('MetaWebhookEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    leadgen_id: { type: DataTypes.STRING, allowNull: false },
    page_id: { type: DataTypes.STRING },
    form_id: { type: DataTypes.STRING },
    raw_payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // 'pending' | 'processed' | 'failed' | 'ignored_duplicate'
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.TEXT },
    resulting_lead_id: { type: DataTypes.UUID },
    processed_at: { type: DataTypes.DATE }
  }, {
    tableName: 'meta_webhook_events',
    underscored: true,
    paranoid: false,
    updatedAt: false
  });

  MetaWebhookEvent.associate = (models) => {
    MetaWebhookEvent.belongsTo(models.Lead, { foreignKey: 'resulting_lead_id', as: 'lead' });
  };

  return MetaWebhookEvent;
};
