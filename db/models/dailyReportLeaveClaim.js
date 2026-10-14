// "I was on leave" for one reporting date. Distinct from the existing
// leave_requests table on purpose: that is a forward-looking HR leave
// application with a date range and a leave type, while this is a
// retrospective exemption for a single reporting date in this module's
// warning ledger. Reusing leave_requests would have meant overloading its
// status machine and its approval routing with a different meaning.
module.exports = (sequelize, DataTypes) => {
  const DailyReportLeaveClaim = sequelize.define('DailyReportLeaveClaim', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    // Captured at claim time so the HR queue can group by department without
    // a join, and a later transfer doesn't rewrite history.
    department_id: { type: DataTypes.UUID },
    report_date: { type: DataTypes.DATEONLY, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    // [{ name, path, size }] from the app's existing upload pipeline.
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // 'PENDING' | 'APPROVED' | 'REJECTED'
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PENDING' },
    reviewed_by: { type: DataTypes.UUID },
    reviewed_at: { type: DataTypes.DATE },
    decision_reason: { type: DataTypes.TEXT }
  }, {
    tableName: 'daily_report_leave_claims',
    underscored: true,
    paranoid: true
  });

  DailyReportLeaveClaim.associate = (models) => {
    DailyReportLeaveClaim.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    DailyReportLeaveClaim.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    DailyReportLeaveClaim.belongsTo(models.User, { foreignKey: 'reviewed_by', as: 'reviewer' });
  };

  return DailyReportLeaveClaim;
};
