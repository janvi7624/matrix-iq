// Append-only record of who opened which piece of collateral.
// See the 20261020098000 migration for why this is a table, not a counter.
module.exports = (sequelize, DataTypes) => {
  const MaterialAccessLog = sequelize.define('MaterialAccessLog', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    material_id: { type: DataTypes.UUID, allowNull: false },
    user_id: { type: DataTypes.UUID },
    // Null for internal staff; set for a partner so usage can be attributed
    // per partner company without joining back through users.
    partner_id: { type: DataTypes.UUID },
    action: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'view' },
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'material_access_logs',
    underscored: true,
    timestamps: false,
    paranoid: false
  });

  MaterialAccessLog.associate = (models) => {
    MaterialAccessLog.belongsTo(models.Material, { foreignKey: 'material_id', as: 'material' });
  };

  return MaterialAccessLog;
};
