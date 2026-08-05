module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define('Product', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    categoryId: { type: DataTypes.UUID },
    name: { type: DataTypes.STRING },
    sku: { type: DataTypes.STRING, unique: true },
    // Free-text legacy label alongside categoryId, per existing ProductRecord.category field.
    category: { type: DataTypes.STRING },
    brand: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    unit: { type: DataTypes.STRING },
    defaultQty: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    basePrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    sellingPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    taxPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    hsnSac: { type: DataTypes.STRING },
    discountPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    imageUrl: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    createdBy: { type: DataTypes.UUID }
  }, {
    tableName: 'products',
    underscored: false,
    paranoid: true
  });

  Product.associate = (models) => {
    Product.belongsTo(models.ProductCategory, { foreignKey: 'categoryId', as: 'productCategory' });
    Product.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    Product.hasMany(models.ProductPricing, { foreignKey: 'productId', as: 'pricingHistory' });
  };

  return Product;
};
