module.exports = (sequelize, DataTypes) => {
  const QuotationProduct = sequelize.define('QuotationProduct', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    quotation_id: { type: DataTypes.UUID, allowNull: false },
    domain_key: { type: DataTypes.STRING },
    label: { type: DataTypes.STRING },
    description: { type: DataTypes.STRING },
    qty: { type: DataTypes.DECIMAL(12, 2) },
    rate: { type: DataTypes.DECIMAL(14, 2) },
    amount: { type: DataTypes.DECIMAL(14, 2) },
    unit: { type: DataTypes.STRING },
    remark: { type: DataTypes.TEXT },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'quotation_products',
    underscored: true,
    paranoid: false
  });

  QuotationProduct.associate = (models) => {
    QuotationProduct.belongsTo(models.Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
  };

  return QuotationProduct;
};
