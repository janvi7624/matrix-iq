module.exports = (sequelize, DataTypes) => {
  const DeliveryChallanItem = sequelize.define('DeliveryChallanItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    delivery_challan_id: { type: DataTypes.UUID, allowNull: false },
    product: { type: DataTypes.STRING },
    serial_number: { type: DataTypes.STRING },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'delivery_challan_items',
    underscored: true,
    paranoid: false
  });

  DeliveryChallanItem.associate = (models) => {
    DeliveryChallanItem.belongsTo(models.DeliveryChallan, { foreignKey: 'delivery_challan_id', as: 'deliveryChallan' });
  };

  return DeliveryChallanItem;
};
