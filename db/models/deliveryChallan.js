module.exports = (sequelize, DataTypes) => {
  const DeliveryChallan = sequelize.define('DeliveryChallan', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    dc_number: { type: DataTypes.STRING, unique: true },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    // Nullable — a manual DC (Back Office creating one directly, with no
    // Sales Request/approval chain behind it) has no demo to link to.
    demo_id: { type: DataTypes.UUID, allowNull: true },
    client_name: { type: DataTypes.STRING },
    client_address: { type: DataTypes.STRING },
    client_phone: { type: DataTypes.STRING },
    issued_by: { type: DataTypes.STRING },
    // Resolved from the issuing employee's User.phone once, at creation time.
    issued_by_phone: { type: DataTypes.STRING },
    issued_date: { type: DataTypes.DATEONLY },
    expected_return_date: { type: DataTypes.DATEONLY },
    assigned_engineer: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('prepared', 'dispatched', 'returned', 'closed'), allowNull: false, defaultValue: 'prepared' },
    // MaterialReturnChecklist shape kept as ONE JSONB object column.
    material_return: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'delivery_challans',
    underscored: true,
    paranoid: true
  });

  DeliveryChallan.associate = (models) => {
    DeliveryChallan.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    DeliveryChallan.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    DeliveryChallan.belongsTo(models.DemoSchedule, { foreignKey: 'demo_id', as: 'demoSchedule' });
    DeliveryChallan.hasMany(models.DeliveryChallanItem, { foreignKey: 'delivery_challan_id', as: 'items' });
  };

  return DeliveryChallan;
};
