module.exports = (sequelize, DataTypes) => {
  const ProductCategory = sequelize.define('ProductCategory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    description: { type: DataTypes.TEXT },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    createdBy: { type: DataTypes.UUID },
    updatedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'product_categories',
    underscored: false,
    paranoid: true
  });

  ProductCategory.associate = (models) => {
    ProductCategory.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    ProductCategory.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    ProductCategory.hasMany(models.Product, { foreignKey: 'categoryId', as: 'products' });
  };

  return ProductCategory;
};
