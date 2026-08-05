// History/tiers table — new, not yet present in lib/types.ts, future-ready per spec.
module.exports = (sequelize, DataTypes) => {
  const ProductPricing = sequelize.define('ProductPricing', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    productId: { type: DataTypes.UUID, allowNull: false },
    priceType: { type: DataTypes.ENUM('base', 'selling', 'tier') },
    price: { type: DataTypes.DECIMAL(14, 2) },
    effectiveFrom: { type: DataTypes.DATEONLY },
    effectiveTo: { type: DataTypes.DATEONLY },
    createdBy: { type: DataTypes.UUID }
  }, {
    tableName: 'product_pricing',
    underscored: false,
    paranoid: false
  });

  ProductPricing.associate = (models) => {
    ProductPricing.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    ProductPricing.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
  };

  return ProductPricing;
};
