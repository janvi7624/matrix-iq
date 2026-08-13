module.exports = (sequelize, DataTypes) => {
  const DemoSchedule = sequelize.define('DemoSchedule', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    quotation_id: { type: DataTypes.UUID },
    client_name: { type: DataTypes.STRING },
    company: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING },
    product_domains: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    products_demonstrated: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
    assigned_technical_person: { type: DataTypes.STRING },
    assigned_technical_person_id: { type: DataTypes.UUID },
    technical_members: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    scheduled_at: { type: DataTypes.DATE },
    assigned_rep: { type: DataTypes.STRING },
    status: {
      type: DataTypes.ENUM(
        'draft', 'pending_technical', 'pending_manager', 'pending_backoffice',
        'dc_generated', 'material_dispatched', 'demo_completed', 'material_returned',
        'dc_closed', 'cancelled'
      ),
      allowNull: false,
      defaultValue: 'draft'
    },
    // Kept as ONE JSONB object column (DemoTechnicalApproval shape), not flattened.
    technical_approval: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // Kept as ONE JSONB object column (DemoManagerApproval shape), not flattened.
    manager_approval: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    notes: { type: DataTypes.TEXT },
    demo_objective: { type: DataTypes.TEXT },
    outcome: { type: DataTypes.ENUM('successful', 'need_followup', 'pending_decision', 'cancelled') },
    customer_rating: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    key_queries: { type: DataTypes.TEXT },
    technical_challenges: { type: DataTypes.TEXT },
    unanswered_queries: { type: DataTypes.TEXT },
    suggested_next_action: { type: DataTypes.TEXT },
    next_follow_up_date: { type: DataTypes.DATEONLY },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'demo_schedule',
    underscored: true,
    paranoid: true
  });

  DemoSchedule.associate = (models) => {
    DemoSchedule.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    DemoSchedule.belongsTo(models.User, { foreignKey: 'assigned_technical_person_id', as: 'assignedTechnicalPersonRef' });
    DemoSchedule.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    DemoSchedule.belongsTo(models.Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
    DemoSchedule.hasMany(models.DemoProductLine, { foreignKey: 'demo_schedule_id', as: 'productLines' });
    DemoSchedule.hasMany(models.CustomerResponse, { foreignKey: 'demo_id', as: 'customerResponses' });
    DemoSchedule.hasMany(models.DeliveryChallan, { foreignKey: 'demo_id', as: 'deliveryChallans' });
  };

  return DemoSchedule;
};
