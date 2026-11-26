// One onboarding document a partner owes — Agreement, NDA, GST or PAN.
// See the 20261102090000-partner-onboarding-documents migration
// for why this is its own table rather than three columns on partners.
module.exports = (sequelize, DataTypes) => {
  const PartnerDocument = sequelize.define('PartnerDocument', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    partner_id: { type: DataTypes.UUID, allowNull: false },
    // 'agreement' | 'nda' | 'gst' | 'pan' — PARTNER_DOCUMENT_KINDS in
    // lib/partnerOnboarding.ts.
    kind: { type: DataTypes.STRING(32), allowNull: false },
    // [{ name, path, size }], stored under the partner's own upload prefix
    // (lib/partnerUploads.ts) so one partner can never read another's.
    files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // 'pending' | 'approved' | 'rejected'. There is no 'not_started': a row
    // exists only once something has been uploaded, and absence IS that
    // state (see onboardingProgress).
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    submitted_at: { type: DataTypes.DATE },
    submitted_by: { type: DataTypes.UUID },
    reviewed_by: { type: DataTypes.UUID },
    reviewed_at: { type: DataTypes.DATE },
    review_remarks: { type: DataTypes.TEXT }
  }, {
    tableName: 'partner_documents',
    underscored: true,
    paranoid: true
  });

  PartnerDocument.associate = (models) => {
    PartnerDocument.belongsTo(models.Partner, { foreignKey: 'partner_id', as: 'partner' });
    PartnerDocument.belongsTo(models.User, { foreignKey: 'submitted_by', as: 'submitter' });
    PartnerDocument.belongsTo(models.User, { foreignKey: 'reviewed_by', as: 'reviewer' });
  };

  return PartnerDocument;
};
