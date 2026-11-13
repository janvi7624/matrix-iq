module.exports = (sequelize, DataTypes) => {
  const ProductManagerNote = sequelize.define('ProductManagerNote', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    product_manager_id: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.ENUM('feedback', 'action', 'plan'), allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'product_manager_notes',
    underscored: true,
    paranoid: false
  });

  ProductManagerNote.associate = (models) => {
    ProductManagerNote.belongsTo(models.User, { foreignKey: 'product_manager_id', as: 'productManager' });
    ProductManagerNote.belongsTo(models.User, { foreignKey: 'created_by', as: 'author' });
  };

  return ProductManagerNote;
};
