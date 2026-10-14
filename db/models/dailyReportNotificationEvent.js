// The scheduler's idempotency ledger: one row per (employee, reporting date,
// event). The row is claimed BEFORE the send, so a crash between the two
// loses a notification rather than duplicating one — the safe direction when
// the recipient is real staff, and what makes retrying a sweep free.
module.exports = (sequelize, DataTypes) => {
  const DailyReportNotificationEvent = sequelize.define('DailyReportNotificationEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    employee_id: { type: DataTypes.UUID, allowNull: false },
    report_date: { type: DataTypes.DATEONLY, allowNull: false },
    // 'REMINDER_EVENING' | 'REMINDER_FINAL' | 'WARNING' | 'SUBMITTED'.
    // 'SUBMITTED' is here so repeated submit requests can't produce
    // duplicate manager notifications either.
    event_key: { type: DataTypes.STRING, allowNull: false },
    // When it was due, versus when it was processed — the gap is what a
    // catch-up run after downtime looks like in the admin log.
    due_at: { type: DataTypes.DATE },
    processed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    // 'sent' | 'skipped' | 'failed' | 'dry_run'
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'sent' },
    channels: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    error: { type: DataTypes.TEXT }
  }, {
    tableName: 'daily_report_notification_events',
    underscored: true,
    paranoid: false
  });

  DailyReportNotificationEvent.associate = (models) => {
    DailyReportNotificationEvent.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
  };

  return DailyReportNotificationEvent;
};
