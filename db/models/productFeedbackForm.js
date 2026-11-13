module.exports = (sequelize, DataTypes) => {
  const ProductFeedbackForm = sequelize.define('ProductFeedbackForm', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    product_manager_id: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    questions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' }
  }, {
    tableName: 'product_feedback_forms',
    underscored: true,
    paranoid: false
  });

  ProductFeedbackForm.associate = (models) => {
    ProductFeedbackForm.belongsTo(models.User, { foreignKey: 'product_manager_id', as: 'owner' });
    ProductFeedbackForm.hasMany(models.ProductFeedbackResponse, { foreignKey: 'form_id', as: 'responses' });
  };

  return ProductFeedbackForm;
};
