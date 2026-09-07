module.exports = (sequelize, DataTypes) => {
  const AttendanceRecord = sequelize.define('AttendanceRecord', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    user_id: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.ENUM('present', 'absent', 'half_day', 'on_leave', 'holiday', 'wfh'), allowNull: false },
    marked_by: { type: DataTypes.UUID },
    remarks: { type: DataTypes.TEXT }
  }, {
    tableName: 'attendance_records',
    underscored: true
  });

  AttendanceRecord.associate = (models) => {
    AttendanceRecord.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    AttendanceRecord.belongsTo(models.User, { foreignKey: 'marked_by', as: 'markedBy' });
  };

  return AttendanceRecord;
};
