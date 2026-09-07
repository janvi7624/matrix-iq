module.exports = (sequelize, DataTypes) => {
  const HrTaskCategory = sequelize.define('HrTaskCategory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'hr_task_categories',
    underscored: true
  });

  return HrTaskCategory;
};
