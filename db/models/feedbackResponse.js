'use strict';

// Must be listed in db/models/index.js's STATIC require list or db.FeedbackResponse
// is undefined at runtime. Note also that lib/db.ts caches the whole registry on
// `global.__nantaDb`, which survives Next's hot reload — after adding a model the
// dev server has to be restarted or it keeps serving the old registry.
module.exports = (sequelize, DataTypes) => {
  const FeedbackResponse = sequelize.define(
    'FeedbackResponse',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      user_id: { type: DataTypes.UUID, allowNull: true },
      username: { type: DataTypes.STRING(120), allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false },
      role: { type: DataTypes.STRING(60), allowNull: false },
      department: { type: DataTypes.STRING(120), allowNull: true },
      designation: { type: DataTypes.STRING(160), allowNull: true },
      overall_rating: { type: DataTypes.INTEGER, allowNull: true },
      overall_comment: { type: DataTypes.TEXT, allowNull: true },
      module_feedback: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      works_well: { type: DataTypes.TEXT, allowNull: true },
      slows_me_down: { type: DataTypes.TEXT, allowNull: true },
      missing_features: { type: DataTypes.TEXT, allowNull: true },
      submitted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'feedback_responses',
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  FeedbackResponse.associate = (models) => {
    FeedbackResponse.belongsTo(models.User, { foreignKey: 'user_id', as: 'respondent' });
  };

  return FeedbackResponse;
};
