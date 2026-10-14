// Which daily report format a department files. One row per department; the
// field sets themselves are code (lib/dailyReportTemplates.ts) and this row
// holds the assignment plus the narrow admin-editable overrides.
module.exports = (sequelize, DataTypes) => {
  const DailyReportTemplate = sequelize.define('DailyReportTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    department_id: { type: DataTypes.UUID, allowNull: false },
    // Plain string, not an ENUM — a new format must be addable without a
    // migration, and PG enum values can never be dropped.
    template_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'not_configured' },
    // 'active' | 'not_configured'. The latter excludes the department's
    // employees from reminders and warnings entirely.
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'not_configured' },
    // { options, linkedOptions, minEntries, measures, channels } — see
    // TemplateOverrides in lib/dailyReportTemplates.ts.
    overrides: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // Additional people notified on submission, on top of this department's
    // managers from Department Master.
    extra_manager_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    notes: { type: DataTypes.TEXT },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'daily_report_templates',
    underscored: true,
    paranoid: true
  });

  DailyReportTemplate.associate = (models) => {
    DailyReportTemplate.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    DailyReportTemplate.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return DailyReportTemplate;
};
