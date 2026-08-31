module.exports = (sequelize, DataTypes) => {
  const OfficeOperationExpense = sequelize.define('OfficeOperationExpense', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Filled by the column's Postgres sequence default, never by the app —
    // see the migration. Marked autoIncrement so Sequelize treats it as
    // DB-generated and leaves it out of INSERTs even if a caller passes one.
    sr_no: { type: DataTypes.INTEGER, autoIncrement: true, allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    usecase: { type: DataTypes.STRING, allowNull: false },
    usecase_detail: { type: DataTypes.STRING },
    expense_head: { type: DataTypes.STRING, allowNull: false },
    item_name: { type: DataTypes.STRING, allowNull: false },
    item_sub_name: { type: DataTypes.STRING },
    // Optional — NULL means "no quantity given" (an electricity bill has no
    // meaningful count). Deliberately no defaultValue: a fabricated 1 would
    // read as real data in the register.
    item_qty: { type: DataTypes.DECIMAL(10, 2) },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false }
  }, {
    tableName: 'office_operation_expenses',
    underscored: true,
    paranoid: false
  });

  OfficeOperationExpense.associate = (models) => {
    OfficeOperationExpense.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return OfficeOperationExpense;
};
