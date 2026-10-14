// One activity/task row inside a row-based report (HR, R&D, AI, Marketing,
// Robotics). Separate rows rather than a JSON array on the report so a
// manager view can count and filter entries in SQL.
module.exports = (sequelize, DataTypes) => {
  const DailyReportEntry = sequelize.define('DailyReportEntry', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    report_id: { type: DataTypes.UUID, allowNull: false },
    // 0-based display order; also what the generated Task ID is numbered from.
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // The template's row fields keyed by field key, validated server-side
    // against the resolved template before it reaches here.
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'daily_report_entries',
    underscored: true,
    paranoid: true
  });

  DailyReportEntry.associate = (models) => {
    DailyReportEntry.belongsTo(models.DailyReport, { foreignKey: 'report_id', as: 'report' });
  };

  return DailyReportEntry;
};
