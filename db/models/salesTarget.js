module.exports = (sequelize, DataTypes) => {
  const SalesTarget = sequelize.define('SalesTarget', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    period_type: { type: DataTypes.STRING(20), allowNull: false }, // monthly | quarterly | half_yearly | annual
    period_start: { type: DataTypes.DATEONLY, allowNull: false },
    period_end: { type: DataTypes.DATEONLY, allowNull: false },
    display_period: { type: DataTypes.STRING, allowNull: false },
    fiscal_year: { type: DataTypes.STRING(7), allowNull: false },
    target_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    updated_by: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'sales_targets',
    underscored: true,
    paranoid: true
  });

  SalesTarget.associate = (models) => {
    SalesTarget.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    SalesTarget.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    SalesTarget.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return SalesTarget;
};
