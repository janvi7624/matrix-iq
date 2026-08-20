module.exports = (sequelize, DataTypes) => {
  const TmsProcurement = sequelize.define('TmsProcurement', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    procurement_code: { type: DataTypes.STRING, unique: true },
    project_id: { type: DataTypes.UUID, allowNull: false },
    // Nullable — supports both the normal BOM -> Procurement chain and a
    // standalone manual entry created directly under Procurement.
    bom_request_id: { type: DataTypes.UUID },
    item_name: { type: DataTypes.STRING },
    part_number: { type: DataTypes.STRING },
    quantity: { type: DataTypes.INTEGER },
    vendor: { type: DataTypes.STRING },
    estimated_cost: { type: DataTypes.DECIMAL(14, 2) },
    quoted_cost: { type: DataTypes.DECIMAL(14, 2) },
    final_cost: { type: DataTypes.DECIMAL(14, 2) },
    request_date: { type: DataTypes.DATEONLY },
    required_date: { type: DataTypes.DATEONLY },
    expected_delivery_date: { type: DataTypes.DATEONLY },
    actual_delivery_date: { type: DataTypes.DATEONLY },
    purchase_status: {
      type: DataTypes.ENUM('requested', 'quotation_required', 'quotation_received', 'approval_pending', 'approved', 'po_created', 'ordered', 'cancelled'),
      allowNull: false,
      defaultValue: 'requested'
    },
    delivery_status: {
      type: DataTypes.ENUM('pending', 'partially_received', 'received', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    remarks: { type: DataTypes.TEXT },
    documents: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_procurement',
    underscored: true,
    paranoid: true
  });

  TmsProcurement.associate = (models) => {
    TmsProcurement.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    TmsProcurement.belongsTo(models.TmsProject, { foreignKey: 'project_id', as: 'project' });
    TmsProcurement.belongsTo(models.TmsBomRequest, { foreignKey: 'bom_request_id', as: 'bomRequest' });
  };

  return TmsProcurement;
};
