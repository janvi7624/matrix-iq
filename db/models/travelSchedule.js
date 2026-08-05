module.exports = (sequelize, DataTypes) => {
  const TravelSchedule = sequelize.define('TravelSchedule', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    origin: { type: DataTypes.STRING },
    destination: { type: DataTypes.STRING },
    start_date: { type: DataTypes.DATEONLY },
    end_date: { type: DataTypes.DATEONLY },
    purpose: { type: DataTypes.TEXT },
    linked_client: { type: DataTypes.STRING },
    expense_note: { type: DataTypes.TEXT }
  }, {
    tableName: 'travel_schedule',
    underscored: true,
    paranoid: false
  });

  TravelSchedule.associate = (models) => {
    TravelSchedule.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return TravelSchedule;
};
