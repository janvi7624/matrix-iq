module.exports = (sequelize, DataTypes) => {
  const DemoProductLine = sequelize.define('DemoProductLine', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    demo_schedule_id: { type: DataTypes.UUID, allowNull: false },
    product: { type: DataTypes.STRING },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'demo_product_lines',
    underscored: true,
    paranoid: false
  });

  DemoProductLine.associate = (models) => {
    DemoProductLine.belongsTo(models.DemoSchedule, { foreignKey: 'demo_schedule_id', as: 'demoSchedule' });
  };

  return DemoProductLine;
};
