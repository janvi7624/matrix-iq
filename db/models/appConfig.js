// Always exactly one row.
module.exports = (sequelize, DataTypes) => {
  const AppConfig = sequelize.define('AppConfig', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    companyName: { type: DataTypes.STRING },
    companyLegalName: { type: DataTypes.STRING },
    gstNumber: { type: DataTypes.STRING },
    panNumber: { type: DataTypes.STRING },
    addressLine1: { type: DataTypes.STRING },
    addressLine2: { type: DataTypes.STRING },
    addressLine3: { type: DataTypes.STRING },
    contactPhone: { type: DataTypes.STRING },
    contactEmail: { type: DataTypes.STRING },
    website: { type: DataTypes.STRING },
    bankAccountName: { type: DataTypes.STRING },
    bankAccountNumber: { type: DataTypes.STRING },
    bankIfsc: { type: DataTypes.STRING },
    bankName: { type: DataTypes.STRING },
    bankBranch: { type: DataTypes.STRING },
    currencyCode: { type: DataTypes.STRING },
    currencySymbol: { type: DataTypes.STRING },
    defaultTaxPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    taxLabel: { type: DataTypes.STRING },
    quotationTerms: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    dcNumberPrefix: { type: DataTypes.STRING },
    notificationTemplates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // The default person new Marketing Requests route to — distinct from
    // the role-level "approve" capability (lib/permissions.ts), which
    // governs who CAN review a ticket, not who it lands on by default.
    marketingOwnerId: { type: DataTypes.UUID },
    updatedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'app_config',
    underscored: false,
    paranoid: false
  });

  AppConfig.associate = (models) => {
    AppConfig.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    AppConfig.belongsTo(models.User, { foreignKey: 'marketingOwnerId', as: 'marketingOwner' });
  };

  return AppConfig;
};
