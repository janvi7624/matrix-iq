module.exports = (sequelize, DataTypes) => {
  const Lead = sequelize.define('Lead', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    name: { type: DataTypes.STRING },
    mobile: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    designation: { type: DataTypes.STRING },
    company: { type: DataTypes.STRING },
    city: { type: DataTypes.STRING },
    card_image_url: { type: DataTypes.STRING },
    interests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sub_interests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    priority: { type: DataTypes.ENUM('hot', 'warm', 'cool') },
    follow_up_actions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    budget: { type: DataTypes.STRING },
    notes: { type: DataTypes.TEXT },
    // Set once "Convert to Project" runs.
    project_id: { type: DataTypes.UUID },
    // 'manual' | 'business_card' | 'csv_import' | 'meta_lead_ads'
    source: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'manual' },
    // Meta (Facebook/Instagram) Lead Ads attribution — see lib/metaLeadIngest.ts.
    // meta_lead_id has a DB-level unique index (migration
    // 20260901120000-add-meta-fields-to-leads.js) so the same Meta lead can
    // never create two rows, even under concurrent webhook delivery.
    meta_lead_id: { type: DataTypes.STRING },
    meta_page_id: { type: DataTypes.STRING },
    meta_form_id: { type: DataTypes.STRING },
    meta_form_name: { type: DataTypes.STRING },
    meta_campaign_id: { type: DataTypes.STRING },
    meta_campaign_name: { type: DataTypes.STRING },
    meta_adset_id: { type: DataTypes.STRING },
    meta_adset_name: { type: DataTypes.STRING },
    meta_ad_id: { type: DataTypes.STRING },
    meta_ad_name: { type: DataTypes.STRING },
    // 'fb' | 'ig'
    meta_platform: { type: DataTypes.STRING(10) },
    meta_created_at: { type: DataTypes.DATE },
    // Every raw field_data entry Meta sent, including custom/unmapped form
    // questions that don't map onto a MatrixIQ column — nothing is discarded.
    meta_raw_field_data: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'leads',
    underscored: true,
    paranoid: true
  });

  Lead.associate = (models) => {
    Lead.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    Lead.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return Lead;
};
