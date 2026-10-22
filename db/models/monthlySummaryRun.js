// Generic idempotency ledger shared by every "1st of the month" summary
// job — see the migration for why this is one shared table, not one per job.
module.exports = (sequelize, DataTypes) => {
  const MonthlySummaryRun = sequelize.define('MonthlySummaryRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    job_key: { type: DataTypes.STRING(64), allowNull: false },
    scope_key: { type: DataTypes.STRING(64), allowNull: false },
    month_key: { type: DataTypes.STRING(7), allowNull: false },
    sent_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    recipient_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'monthly_summary_runs',
    underscored: true,
    paranoid: false,
    timestamps: false
  });

  return MonthlySummaryRun;
};
