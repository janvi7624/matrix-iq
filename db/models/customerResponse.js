module.exports = (sequelize, DataTypes) => {
  const CustomerResponse = sequelize.define('CustomerResponse', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    demo_id: { type: DataTypes.UUID },
    feedback: { type: DataTypes.TEXT },
    response_type: { type: DataTypes.ENUM('interested', 'not_interested', 'need_revision', 'need_new_quotation', 'budget_issue', 'competitor') },
    expected_decision_date: { type: DataTypes.DATEONLY },
    remarks: { type: DataTypes.TEXT }
  }, {
    tableName: 'customer_responses',
    underscored: true,
    paranoid: true
  });

  CustomerResponse.associate = (models) => {
    CustomerResponse.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    CustomerResponse.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    CustomerResponse.belongsTo(models.DemoSchedule, { foreignKey: 'demo_id', as: 'demoSchedule' });
  };

  return CustomerResponse;
};
