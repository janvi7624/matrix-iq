module.exports = (sequelize, DataTypes) => {
  const Reimbursement = sequelize.define('Reimbursement', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    description: { type: DataTypes.TEXT },
    employee_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
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
    admin_split_count: { type: DataTypes.INTEGER }
  }, {
    tableName: 'reimbursements',
    underscored: true,
    paranoid: false
  });

  Reimbursement.associate = (models) => {
    Reimbursement.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return Reimbursement;
};
