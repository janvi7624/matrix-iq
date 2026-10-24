module.exports = (sequelize, DataTypes) => {
  const PartnerQuotationRequest = sequelize.define('PartnerQuotationRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    partner_id: { type: DataTypes.UUID, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    requested_by_user_id: { type: DataTypes.UUID },
    requirements: { type: DataTypes.TEXT, allowNull: false },
    products: { type: DataTypes.TEXT },
    quantity_note: { type: DataTypes.STRING(255) },
    needed_by: { type: DataTypes.DATEONLY },
    urgency: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
    // open | in_progress | quoted | declined. STRING not ENUM — see the
    // 20261024120000 migration, and lib/partnerQuotationRequestStages.ts for
    // the legal transitions.
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
    quotation_id: { type: DataTypes.UUID },
    response_note: { type: DataTypes.TEXT },
    handled_by_user_id: { type: DataTypes.UUID },
    handled_at: { type: DataTypes.DATE }
  }, {
    tableName: 'partner_quotation_requests',
    underscored: true,
    paranoid: true
  });

  PartnerQuotationRequest.associate = (models) => {
    PartnerQuotationRequest.belongsTo(models.Partner, { foreignKey: 'partner_id', as: 'partner' });
    PartnerQuotationRequest.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    PartnerQuotationRequest.belongsTo(models.User, { foreignKey: 'requested_by_user_id', as: 'requester' });
    PartnerQuotationRequest.belongsTo(models.User, { foreignKey: 'handled_by_user_id', as: 'handler' });
    PartnerQuotationRequest.belongsTo(models.Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
  };

  return PartnerQuotationRequest;
};
