module.exports = (sequelize, DataTypes) => {
  const TmsProjectPhase = sequelize.define('TmsProjectPhase', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    tms_project_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    // What this feature exists for — the deadline of this phase, as distinct
    // from the project's own single `deadline`.
    expected_end_date: { type: DataTypes.DATEONLY },
    // Delivery order, reorderable; creation order is rarely delivery order.
    sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), allowNull: false, defaultValue: 'pending' },
    // Set when status flips to 'completed', cleared on reopen — see
    // lib/tmsProjectPhaseStore.ts, same pattern as projects.closed_at.
    completed_at: { type: DataTypes.DATEONLY },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_project_phases',
    underscored: true,
    paranoid: true
  });

  TmsProjectPhase.associate = (models) => {
    TmsProjectPhase.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'project' });
    TmsProjectPhase.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return TmsProjectPhase;
};
