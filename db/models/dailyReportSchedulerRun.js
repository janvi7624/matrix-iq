// Administrator-facing log of every sweep. Without it, a scheduler that has
// silently stopped running looks exactly like a month in which everybody
// filed on time.
module.exports = (sequelize, DataTypes) => {
  const DailyReportSchedulerRun = sequelize.define('DailyReportSchedulerRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    job_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'daily_report_sweep' },
    started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    finished_at: { type: DataTypes.DATE },
    // 'running' | 'ok' | 'partial' | 'failed' | 'skipped'
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'running' },
    dry_run: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // 'cron' | 'manual' — a manual run from the admin page is distinguishable
    // from the scheduled one.
    trigger: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cron' },
    stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    error: { type: DataTypes.TEXT }
  }, {
    tableName: 'daily_report_scheduler_runs',
    underscored: true,
    paranoid: false
  });

  return DailyReportSchedulerRun;
};
