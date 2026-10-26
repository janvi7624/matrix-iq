// The one row of edited Office Operation Expense picklists.
//
// Every list column is NULLABLE on purpose: NULL means "not customised", and
// lib/officeExpenseOptionResolve.ts falls back to the hardcoded base so the
// department keeps following the code. An empty array is a different thing —
// it would mean someone emptied the list — and the resolver treats it as
// such rather than silently restoring the base.
module.exports = (sequelize, DataTypes) => {
  const OfficeExpenseOptionSet = sequelize.define('OfficeExpenseOptionSet', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    usecases: { type: DataTypes.JSONB, allowNull: true },
    usecase_sub_options: { type: DataTypes.JSONB, allowNull: true },
    items: { type: DataTypes.JSONB, allowNull: true },
    item_sub_options: { type: DataTypes.JSONB, allowNull: true },
    singleton: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    updated_by: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'office_expense_option_set',
    underscored: true
  });

  OfficeExpenseOptionSet.associate = (models) => {
    OfficeExpenseOptionSet.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return OfficeExpenseOptionSet;
};
