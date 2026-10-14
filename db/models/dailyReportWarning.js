// One missed working day. Never deleted — waiving sets status to 'WAIVED',
// which keeps the record visible in history while removing it from the
// active count, so a waiver is auditable and a month's history stays honest.
module.exports = (sequelize, DataTypes) => {
  const DailyReportWarning = sequelize.define('DailyReportWarning', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    department_id: { type: DataTypes.UUID },
    report_date: { type: DataTypes.DATEONLY, allowNull: false },
    // 'YYYY-MM' of report_date — stored, not derived, so the monthly active
    // count is an indexed equality rather than a to_char() table scan.
    month_key: { type: DataTypes.STRING, allowNull: false },
    // 'ACTIVE' | 'WAIVED'
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'ACTIVE' },
    // 'scheduler' | 'leave_rejected'
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'scheduler' },
    waived_by: { type: DataTypes.UUID },
    waived_at: { type: DataTypes.DATE },
    waiver_reason: { type: DataTypes.TEXT }
  }, {
    tableName: 'daily_report_warnings',
    underscored: true,
    paranoid: true
  });

  DailyReportWarning.associate = (models) => {
    DailyReportWarning.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    DailyReportWarning.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    DailyReportWarning.belongsTo(models.User, { foreignKey: 'waived_by', as: 'waivedBy' });
  };

  return DailyReportWarning;
};
