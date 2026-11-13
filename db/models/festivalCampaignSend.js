'use strict';

// One row per (campaign, email) — written before the send, so the unique
// index is the "never mail a client twice for one festival" guard.
module.exports = (sequelize, DataTypes) => {
  const FestivalCampaignSend = sequelize.define('FestivalCampaignSend', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    campaign_id: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false },
    name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
    company: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    error: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }
  }, {
    tableName: 'festival_campaign_sends',
    underscored: true,
    paranoid: false
  });

  FestivalCampaignSend.associate = (models) => {
    FestivalCampaignSend.belongsTo(models.FestivalCampaign, { foreignKey: 'campaign_id', as: 'campaign' });
  };

  return FestivalCampaignSend;
};
