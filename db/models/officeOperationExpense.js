module.exports = (sequelize, DataTypes) => {
  const OfficeOperationExpense = sequelize.define('OfficeOperationExpense', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Filled by the column's Postgres sequence default, never by the app —
    // see the migration. Still sequential, but no longer enforced unique, so a
    // duplicate serial is accepted rather than rejected.
    sr_no: { type: DataTypes.INTEGER, autoIncrement: true, allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    usecase: { type: DataTypes.STRING, allowNull: false },
    usecase_detail: { type: DataTypes.STRING },
    item_name: { type: DataTypes.STRING, allowNull: false },
    // One entry can carry several sub-items, so this is a JSONB array — the
    // same way attachment_urls and employee_ids are stored elsewhere.
    item_sub_names: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Optional — NULL means "no quantity given" (an electricity bill has no
    // meaningful count). Deliberately no defaultValue: a fabricated 1 would
    // read as real data in the register.
    item_qty: { type: DataTypes.DECIMAL(10, 2) },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    description: { type: DataTypes.TEXT },
    remarks: { type: DataTypes.TEXT },
    // Accounts Payment Queue — see db/migrations/20260912180200-office-expense-payment-fields.js
    payment_status: { type: DataTypes.STRING(20) },
    paid_at: { type: DataTypes.DATE },
    paid_by: { type: DataTypes.UUID },
    payment_method: { type: DataTypes.STRING(30) },
    payment_reference: { type: DataTypes.STRING },
    payment_proof_urls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
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
