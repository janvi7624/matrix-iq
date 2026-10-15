// Singleton policy row for the Daily Report module — working days, the
// deadline and reminder clock, the warning threshold, and the two separate
// switches that arm the scheduler and leave dry-run. Always exactly one row
// (see lib/dailyReportConfigStore.ts, which creates it on first read).
module.exports = (sequelize, DataTypes) => {
  const DailyReportConfig = sequelize.define('DailyReportConfig', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Asia/Kolkata' },
    // Day-of-week numbers, 0 = Sunday. Mon–Sat by default, so Sunday is
    // never a reporting date and never attracts a reminder or a warning.
    working_days: { type: DataTypes.JSONB, allowNull: false, defaultValue: [1, 2, 3, 4, 5, 6] },
    holidays: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // False by default: public holidays count as working days until a real
    // holiday calendar is curated, so the list above stays inert rather than
    // being half-applied. See the migration for the full reasoning.
    observe_holidays: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Recurring days off, e.g. [{ nth: 3, weekday: 6 }] — the third Saturday
    // of every month. A rule rather than generated dates, so it never lapses.
    off_nth_weekdays: { type: DataTypes.JSONB, allowNull: false, defaultValue: [{ nth: 3, weekday: 6 }] },
    deadline_time: { type: DataTypes.STRING, allowNull: false, defaultValue: '11:00' },
    evening_reminder_time: { type: DataTypes.STRING, allowNull: false, defaultValue: '21:00' },
    final_reminder_time: { type: DataTypes.STRING, allowNull: false, defaultValue: '10:00' },
    warning_threshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    reconcile_window_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    scheduler_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    dry_run: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // 'reinstate' | 'waive' — what a rejected leave claim does to the
    // reporting obligation for that date.
    leave_rejection_policy: { type: DataTypes.STRING, allowNull: false, defaultValue: 'reinstate' },
    // User ids excused from filing. They leave the expected set entirely —
    // no form, no reminders, no warnings, and they are not counted in
    // anyone's compliance denominator.
    exempt_employee_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'daily_report_config',
    underscored: true,
    paranoid: false
  });

  DailyReportConfig.associate = (models) => {
    DailyReportConfig.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return DailyReportConfig;
};
