// Idempotency ledger for the Back Office monthly summary cron job — see the
// migration for why this exists instead of reusing audit_logs.
module.exports = (sequelize, DataTypes) => {
  const BackOfficeMonthlySummaryRun = sequelize.define('BackOfficeMonthlySummaryRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    month_key: { type: DataTypes.STRING(7), allowNull: false },
    sent_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    recipient_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    demo_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total_expense: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'back_office_monthly_summary_runs',
    underscored: true,
    paranoid: false,
    // sent_at already captures "when" — no separate created_at/updated_at
    // column exists on this table (see the migration).
    timestamps: false
  });

  return BackOfficeMonthlySummaryRun;
};
