// New table, not implemented anywhere in the app yet, per the requested module list.
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING },
    body: { type: DataTypes.TEXT },
    type: { type: DataTypes.STRING },
    entityType: { type: DataTypes.STRING },
    // Polymorphic — no FK constraint.
    entityId: { type: DataTypes.UUID },
    isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'notifications',
    underscored: false,
    paranoid: false
  });

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return Notification;
};
