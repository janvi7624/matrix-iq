// One HR escalation per employee per calendar month. The unique index on
// (employee_id, month_key) in the migration IS the "only one
// threshold-triggered escalation per employee per month" rule — a retry
// mid-send collides with the row instead of producing a second email.
module.exports = (sequelize, DataTypes) => {
  const DailyReportEscalation = sequelize.define('DailyReportEscalation', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    month_key: { type: DataTypes.STRING, allowNull: false },
    // Active-warning count when the threshold was crossed, so the record
    // still explains itself after a later waiver drops the live count.
    warning_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    missed_dates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    notified_at: { type: DataTypes.DATE },
    notified_usernames: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // 'pending' | 'sent' | 'failed' | 'dry_run' — feeds the admin
    // notification-delivery log.
    email_status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    email_error: { type: DataTypes.TEXT },
    // HR recording that they have DEALT with this — not the same as waiving
    // a warning, which is only one of the possible responses. Until this is
    // set, the sweep reminds the HR manager that action is pending.
    acknowledged_at: { type: DataTypes.DATE },
    acknowledged_by: { type: DataTypes.UUID },
    action_note: { type: DataTypes.TEXT },
    reminder_last_sent_at: { type: DataTypes.DATE },
    reminder_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'daily_report_escalations',
    underscored: true,
    paranoid: true
  });

  DailyReportEscalation.associate = (models) => {
    DailyReportEscalation.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    DailyReportEscalation.belongsTo(models.User, { foreignKey: 'acknowledged_by', as: 'acknowledgedBy' });
  };

  return DailyReportEscalation;
};
