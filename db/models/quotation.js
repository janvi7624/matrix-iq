module.exports = (sequelize, DataTypes) => {
  const Quotation = sequelize.define('Quotation', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    quotation_number: { type: DataTypes.STRING, allowNull: false, unique: true },
    project_id: { type: DataTypes.UUID },
    created_by: { type: DataTypes.UUID },
    status: { type: DataTypes.ENUM('draft', 'sent', 'approved', 'rejected'), allowNull: false, defaultValue: 'draft' },
    prepared_by: { type: DataTypes.STRING },
    prepared_by_phone: { type: DataTypes.STRING },
    prepared_by_email: { type: DataTypes.STRING },
    client_name: { type: DataTypes.STRING },
    client_company: { type: DataTypes.STRING },
    client_email: { type: DataTypes.STRING },
    client_phone: { type: DataTypes.STRING },
    client_address: { type: DataTypes.STRING },
    project_vertical: { type: DataTypes.STRING },
    domain_summary: { type: DataTypes.TEXT },
    products_summary: { type: DataTypes.TEXT },
    // Cached full cart/line-item structure — normalized rows also live in
    // quotation_products; this JSONB column is the raw snapshot.
    products_json: { type: DataTypes.JSONB },
    subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    markup_percent: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },
    discount_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    gst_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    validity_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_follow_up_at: { type: DataTypes.DATE },
    // Self-referential — points at the ROOT quotation for a revision.
    original_quotation_id: { type: DataTypes.UUID },
    revision_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    revision_reason: { type: DataTypes.TEXT }
  }, {
    tableName: 'quotations',
    underscored: true,
    paranoid: true
  });

  Quotation.associate = (models) => {
    Quotation.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    Quotation.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Quotation.belongsTo(models.Quotation, { foreignKey: 'original_quotation_id', as: 'originalQuotation' });
    Quotation.hasMany(models.Quotation, { foreignKey: 'original_quotation_id', as: 'revisions' });
    Quotation.hasMany(models.QuotationProduct, { foreignKey: 'quotation_id', as: 'products' });
    Quotation.hasMany(models.QuotationFollowUp, { foreignKey: 'quotation_id', as: 'followUps' });
    Quotation.hasMany(models.DemoSchedule, { foreignKey: 'quotation_id', as: 'demoSchedules' });
  };

  return Quotation;
};
