// One employee's report for one reporting date. The unique index on
// (employee_id, department_id, report_date) lives in the migration — it is
// what makes "one report per employee per day" a database guarantee rather
// than a read-then-write race between two tabs.
module.exports = (sequelize, DataTypes) => {
  const DailyReport = sequelize.define('DailyReport', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Always the employee the day belongs to, including on a manager-filed
    // report — see filed_by_user_id for who did the typing.
    employee_id: { type: DataTypes.UUID, allowNull: false },
    department_id: { type: DataTypes.UUID, allowNull: false },
    // DATEONLY: an IST calendar day, not an instant.
    report_date: { type: DataTypes.DATEONLY, allowNull: false },
    // Frozen at creation so reassigning a department's template later can't
    // retroactively re-interpret a report that was already filed.
    template_key: { type: DataTypes.STRING, allowNull: false },
    // 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE'
    submission_status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'DRAFT' },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    matrix: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // Written once on first submit and never rewritten.
    submitted_at: { type: DataTypes.DATE },
    is_late: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deadline_at: { type: DataTypes.DATE },
    // review_status / reviewed_by / reviewed_at / review_note are deliberately
    // NOT declared here. Manager review was removed; the four Postgres columns
    // are left in place rather than dropped, because review_note is the only
    // record of anything a manager ever asked for and a drop is irreversible.
    // Undeclared means Sequelize neither SELECTs nor writes them, and
    // review_status keeps its NOT NULL DEFAULT so inserts still succeed.
    // Non-null only when a manager filed on the employee's behalf.
    filed_by_user_id: { type: DataTypes.UUID },
    created_by: { type: DataTypes.UUID },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'daily_reports',
    underscored: true,
    paranoid: true
  });

  DailyReport.associate = (models) => {
    DailyReport.belongsTo(models.User, { foreignKey: 'employee_id', as: 'employee' });
    DailyReport.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    DailyReport.belongsTo(models.User, { foreignKey: 'filed_by_user_id', as: 'filedBy' });
    DailyReport.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    DailyReport.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
    DailyReport.hasMany(models.DailyReportEntry, { foreignKey: 'report_id', as: 'entries' });
    DailyReport.hasMany(models.DailyReportRevision, { foreignKey: 'report_id', as: 'revisions' });
  };

  return DailyReport;
};
