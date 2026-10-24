// Partner company master — the tenancy root for the Partner Portal.
// See the 20261020090000-create-partners migration for the full rationale.
module.exports = (sequelize, DataTypes) => {
  const Partner = sequelize.define('Partner', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Human reference ("PTR-0007") — generated in lib/partnerStore.ts, never
    // typed by hand. Unique among non-deleted rows (partial index).
    partner_code: { type: DataTypes.STRING(32), allowNull: false },
    company_name: { type: DataTypes.STRING(255), allowNull: false },
    contact_person: { type: DataTypes.STRING(255) },
    email: { type: DataTypes.STRING(255) },
    phone: { type: DataTypes.STRING(40) },
    address: { type: DataTypes.TEXT },
    city: { type: DataTypes.STRING(120) },
    state: { type: DataTypes.STRING(120) },
    country: { type: DataTypes.STRING(120) },
    gst_number: { type: DataTypes.STRING(32) },
    // 'pending' | 'active' | 'suspended' | 'inactive' — see PartnerStatus in
    // lib/types.ts. Only 'active' may sign in and use the portal; the check
    // runs live on every request (lib/partnerContext.ts), not from the token.
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    // Same vocabulary as Project.departments (lib/projectDepartmentOptions.ts).
    departments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    product_categories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    territory: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    relationship_manager_id: { type: DataTypes.UUID },
    notes: { type: DataTypes.TEXT },
    created_by: { type: DataTypes.UUID },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'partners',
    underscored: true,
    paranoid: true
  });

  Partner.associate = (models) => {
    Partner.belongsTo(models.User, { foreignKey: 'relationship_manager_id', as: 'relationshipManager' });
    Partner.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Partner.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
    // The partner's own login accounts. foreignKey is camelCase because the
    // users table is underscored:false (see db/models/user.js).
    Partner.hasMany(models.User, { foreignKey: 'partnerId', as: 'users' });
  };

  return Partner;
};
