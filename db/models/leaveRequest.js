module.exports = (sequelize, DataTypes) => {
  const LeaveRequest = sequelize.define('LeaveRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    user_id: { type: DataTypes.UUID, allowNull: false },
    leave_type: { type: DataTypes.ENUM('casual', 'sick', 'earned', 'unpaid', 'other'), allowNull: false },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    end_date: { type: DataTypes.DATEONLY, allowNull: false },
    days: { type: DataTypes.DECIMAL(4, 1), allowNull: false },
    reason: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'cancelled'), allowNull: false, defaultValue: 'pending' },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    remarks: { type: DataTypes.TEXT }
  }, {
    tableName: 'leave_requests',
    underscored: true
  });

  LeaveRequest.associate = (models) => {
    LeaveRequest.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    LeaveRequest.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approvedBy' });
  };

  return LeaveRequest;
};
