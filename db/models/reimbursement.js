module.exports = (sequelize, DataTypes) => {
  const Reimbursement = sequelize.define('Reimbursement', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    // Only set for an admin-entry Hotel booking (is_admin_entry &&
    // description === 'Hotel') — `date` above is that booking's check-in.
    // Null for every normal employee reimbursement and every ticket-type
    // admin entry, which only ever have the one date.
    check_out_date: { type: DataTypes.DATEONLY },
    description: { type: DataTypes.TEXT },
    employee_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    guest_names: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    from_location: { type: DataTypes.STRING },
    to_location: { type: DataTypes.STRING },
    kilometers: { type: DataTypes.DECIMAL(10, 2) },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    mode_of_payment: { type: DataTypes.STRING },
    amount_in_words: { type: DataTypes.STRING(500) },
    attachment_urls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    is_admin_entry: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    admin_note: { type: DataTypes.TEXT },
    admin_total_amount: { type: DataTypes.DECIMAL(12, 2) },
    admin_split_count: { type: DataTypes.INTEGER },
    // Accounts Payment Queue — only ever populated for is_admin_entry rows.
    // A normal employee reimbursement row's payment state lives on
    // ReimbursementSheet instead (accounts_handler_id/accounts_completed_at/
    // payment_reference there) and never touches these.
    payment_status: { type: DataTypes.STRING(20) },
    paid_at: { type: DataTypes.DATE },
    paid_by: { type: DataTypes.UUID },
    payment_method: { type: DataTypes.STRING(30) },
    payment_reference: { type: DataTypes.STRING },
    payment_proof_urls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Admin-entry-only approval gate (see app/api/admin-expenses/route.ts) —
    // 'pending_approval' until the designated approver signs off, then
    // 'approved'. Normal employee reimbursements never set this; it stays at
    // its 'approved' default for them.
    approval_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'approved' },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE }
  }, {
    tableName: 'reimbursements',
    underscored: true,
    paranoid: false
  });

  Reimbursement.associate = (models) => {
    Reimbursement.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Reimbursement.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approver' });
  };

  return Reimbursement;
};
