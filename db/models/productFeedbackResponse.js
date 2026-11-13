module.exports = (sequelize, DataTypes) => {
  const ProductFeedbackResponse = sequelize.define('ProductFeedbackResponse', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    form_id: { type: DataTypes.UUID, allowNull: false },
    respondent_id: { type: DataTypes.UUID },
    respondent_name: { type: DataTypes.STRING(255) },
    answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    submitted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'product_feedback_responses',
    underscored: true,
    paranoid: false,
    updatedAt: false
  });

  ProductFeedbackResponse.associate = (models) => {
    ProductFeedbackResponse.belongsTo(models.ProductFeedbackForm, { foreignKey: 'form_id', as: 'form' });
    ProductFeedbackResponse.belongsTo(models.User, { foreignKey: 'respondent_id', as: 'respondent' });
  };

  return ProductFeedbackResponse;
};
