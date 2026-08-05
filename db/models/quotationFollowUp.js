module.exports = (sequelize, DataTypes) => {
  const QuotationFollowUp = sequelize.define('QuotationFollowUp', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    quotation_id: { type: DataTypes.UUID, allowNull: false },
    note: { type: DataTypes.TEXT },
    created_by: { type: DataTypes.STRING }
  }, {
    tableName: 'quotation_follow_ups',
    underscored: true,
    paranoid: false,
    // Append-only: keep Sequelize's automatic createdAt (mapped to created_at)
    // but no updatedAt column.
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  QuotationFollowUp.associate = (models) => {
    QuotationFollowUp.belongsTo(models.Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
  };

  return QuotationFollowUp;
};
