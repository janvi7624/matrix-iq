// Table named `purchase_orders` (not `po`) since `po` is too terse for SQL.
module.exports = (sequelize, DataTypes) => {
  const PurchaseOrder = sequelize.define('PurchaseOrder', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    po_number: { type: DataTypes.STRING },
    po_date: { type: DataTypes.DATEONLY },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    attachment_url: { type: DataTypes.STRING },
    advance_received: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    payment_terms: { type: DataTypes.TEXT }
  }, {
    tableName: 'purchase_orders',
    underscored: true,
    paranoid: true
  });

  PurchaseOrder.associate = (models) => {
    PurchaseOrder.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    PurchaseOrder.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
  };

  return PurchaseOrder;
};
