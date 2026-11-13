'use strict';

// Client festival greeting campaign — see
// db/migrations/20261113120000-create-festival-campaigns.js.
module.exports = (sequelize, DataTypes) => {
  const FestivalCampaign = sequelize.define('FestivalCampaign', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    festival_id: { type: DataTypes.UUID, allowNull: false },
    marketing_request_id: { type: DataTypes.UUID },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'awaiting_creative' },
    headline: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
    message: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    banner_path: { type: DataTypes.STRING(600) },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    rejection_reason: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    sent_at: { type: DataTypes.DATE },
    recipient_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sent_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    dry_run: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'festival_campaigns',
    underscored: true,
    paranoid: false
  });

  FestivalCampaign.associate = (models) => {
    FestivalCampaign.belongsTo(models.Festival, { foreignKey: 'festival_id', as: 'festival' });
    FestivalCampaign.belongsTo(models.MarketingRequest, { foreignKey: 'marketing_request_id', as: 'marketingRequest' });
    FestivalCampaign.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approver' });
  };

  return FestivalCampaign;
};
