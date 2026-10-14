// Append-only content history for one report. audit_logs records who did
// what across the whole app; this keeps the actual snapshot, which audit_logs
// has no column for and which is what makes a post-hoc "what did this report
// say when it was submitted?" answerable.
module.exports = (sequelize, DataTypes) => {
  const DailyReportRevision = sequelize.define('DailyReportRevision', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    report_id: { type: DataTypes.UUID, allowNull: false },
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actor_id: { type: DataTypes.UUID },
    // 'created' | 'draft_saved' | 'submitted' | 'edited' | 'reviewed' |
    // 'filed_for_employee'
    action: { type: DataTypes.STRING, allowNull: false },
    submission_status: { type: DataTypes.STRING },
    // { payload, matrix, entries } as of this revision.
    snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    note: { type: DataTypes.TEXT }
  }, {
    tableName: 'daily_report_revisions',
    underscored: true,
    paranoid: false
  });

  DailyReportRevision.associate = (models) => {
    DailyReportRevision.belongsTo(models.DailyReport, { foreignKey: 'report_id', as: 'report' });
    DailyReportRevision.belongsTo(models.User, { foreignKey: 'actor_id', as: 'actor' });
  };

  return DailyReportRevision;
};
