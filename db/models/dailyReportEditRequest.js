module.exports = (sequelize, DataTypes) => {
  // Permission to edit a report that has already been filed. See
  // 20261026120000-create-daily-report-edit-requests.js for why submission is
  // terminal and why the approver is the department manager.
  const DailyReportEditRequest = sequelize.define('DailyReportEditRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    report_id: { type: DataTypes.UUID, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    // Denormalised so the manager's queue can group by department without a
    // join, and so a later transfer doesn't rewrite history.
    department_id: { type: DataTypes.UUID },
    report_date: { type: DataTypes.DATEONLY, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    // 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED'
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'PENDING' },
    decided_by: { type: DataTypes.UUID },
    decided_at: { type: DataTypes.DATE },
    decision_reason: { type: DataTypes.TEXT },
    grant_expires_at: { type: DataTypes.DATE },
    used_at: { type: DataTypes.DATE }
  }, {
    tableName: 'daily_report_edit_requests',
    underscored: true,
    paranoid: true
  });

  DailyReportEditRequest.associate = (models) => {
    DailyReportEditRequest.belongsTo(models.DailyReport, { foreignKey: 'report_id', as: 'report' });
    DailyReportEditRequest.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    DailyReportEditRequest.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    DailyReportEditRequest.belongsTo(models.User, { foreignKey: 'decided_by', as: 'decider' });
  };

  return DailyReportEditRequest;
};
