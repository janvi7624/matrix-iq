// Sales Project's "extend deadline" (expected_closing_date) history — same
// shape as db/models/tmsProjectDeadlineExtension.js, kept as its own table
// rather than a shared/polymorphic one (this codebase's convention: each
// module gets its own dedicated store/table, audit_log is the one
// deliberate exception).
module.exports = (sequelize, DataTypes) => {
  const ProjectDeadlineExtension = sequelize.define('ProjectDeadlineExtension', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    previous_deadline: { type: DataTypes.DATEONLY },
    new_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    reason: { type: DataTypes.ENUM('user_end', 'client_end'), allowNull: false },
    remark: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending_manager' },
    requested_by: { type: DataTypes.UUID },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    decision_remark: { type: DataTypes.TEXT }
  }, {
    tableName: 'project_deadline_extensions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  ProjectDeadlineExtension.associate = (models) => {
    ProjectDeadlineExtension.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    ProjectDeadlineExtension.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
    ProjectDeadlineExtension.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approvedBy' });
  };

  return ProjectDeadlineExtension;
};
