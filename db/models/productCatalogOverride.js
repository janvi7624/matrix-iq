module.exports = (sequelize, DataTypes) => {
  const ProductCatalogOverride = sequelize.define('ProductCatalogOverride', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    catalog: { type: DataTypes.STRING, allowNull: false },
    productKey: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: true },
    fields: { type: DataTypes.JSONB, allowNull: true },
    updatedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'product_catalog_overrides',
    underscored: false,
    paranoid: false
  });

  ProductCatalogOverride.associate = (models) => {
    ProductCatalogOverride.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
  };

  return ProductCatalogOverride;
};
