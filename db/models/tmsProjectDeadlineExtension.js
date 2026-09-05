module.exports = (sequelize, DataTypes) => {
  const TmsProjectDeadlineExtension = sequelize.define('TmsProjectDeadlineExtension', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    tms_project_id: { type: DataTypes.UUID, allowNull: false },
    previous_deadline: { type: DataTypes.DATEONLY },
    new_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    remark: { type: DataTypes.TEXT, allowNull: false },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    extended_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_project_deadline_extensions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  TmsProjectDeadlineExtension.associate = (models) => {
    TmsProjectDeadlineExtension.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'project' });
    TmsProjectDeadlineExtension.belongsTo(models.User, { foreignKey: 'extended_by', as: 'extendedBy' });
  };

  return TmsProjectDeadlineExtension;
};
