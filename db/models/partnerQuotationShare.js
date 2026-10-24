// An explicit, revocable grant of one quotation to one partner.
// See the 20261020096000 migration for why this is a join table rather than
// a flag on `quotations`.
module.exports = (sequelize, DataTypes) => {
  const PartnerQuotationShare = sequelize.define('PartnerQuotationShare', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    quotation_id: { type: DataTypes.UUID, allowNull: false },
    partner_id: { type: DataTypes.UUID, allowNull: false },
    shared_by: { type: DataTypes.UUID },
    shared_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    // Null = live. Set (never deleted) when access is withdrawn, so the
    // record that it was once shared survives the withdrawal.
    revoked_at: { type: DataTypes.DATE },
    revoked_by: { type: DataTypes.UUID },
    note: { type: DataTypes.TEXT }
  }, {
    tableName: 'partner_quotation_shares',
    underscored: true,
    // Not paranoid: revoked_at already expresses "no longer active", and a
    // second soft-delete concept on the same row would make "is this live"
    // ambiguous.
    paranoid: false
  });

  PartnerQuotationShare.associate = (models) => {
    PartnerQuotationShare.belongsTo(models.Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
    PartnerQuotationShare.belongsTo(models.Partner, { foreignKey: 'partner_id', as: 'partner' });
    PartnerQuotationShare.belongsTo(models.User, { foreignKey: 'shared_by', as: 'sharer' });
    PartnerQuotationShare.belongsTo(models.User, { foreignKey: 'revoked_by', as: 'revoker' });
  };

  return PartnerQuotationShare;
};
