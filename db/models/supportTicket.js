// After-sales support ticket. See the 20261020100000 migration for why this
// is its own subsystem rather than a TmsTask.
module.exports = (sequelize, DataTypes) => {
  const SupportTicket = sequelize.define('SupportTicket', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    ticket_number: { type: DataTypes.STRING(32), allowNull: false },
    // NULL for an internally-raised ticket — staff raise these too.
    partner_id: { type: DataTypes.UUID },
    created_by_user_id: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    quotation_id: { type: DataTypes.UUID },
    title: { type: DataTypes.STRING(255), allowNull: false },
    category: { type: DataTypes.STRING(40) },
    issue_type: { type: DataTypes.STRING(40) },
    product: { type: DataTypes.STRING(255) },
    model_serial: { type: DataTypes.STRING(120) },
    customer_name: { type: DataTypes.STRING(255) },
    location: { type: DataTypes.STRING(255) },
    description: { type: DataTypes.TEXT, allowNull: false },
    priority: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'medium' },
    // STRING not ENUM — lib/supportTicketWorkflow.ts is the authority on the
    // legal values and transitions.
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'new' },
    department_id: { type: DataTypes.UUID },
    assigned_to_id: { type: DataTypes.UUID },
    assigned_by_id: { type: DataTypes.UUID },
    assigned_at: { type: DataTypes.DATE },
    acknowledged_at: { type: DataTypes.DATE },
    occurred_on: { type: DataTypes.DATEONLY },
    // Stamped at triage. Breach is COMPUTED from these, never stored.
    response_due_at: { type: DataTypes.DATE },
    resolution_due_at: { type: DataTypes.DATE },
    first_response_at: { type: DataTypes.DATE },
    resolved_at: { type: DataTypes.DATE },
    closed_at: { type: DataTypes.DATE },
    reopened_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    resolution_summary: { type: DataTypes.TEXT },
    root_cause: { type: DataTypes.TEXT },
    corrective_action: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    contact_person: { type: DataTypes.STRING(255) },
    contact_method: { type: DataTypes.STRING(40) },
    escalated_at: { type: DataTypes.DATE },
    escalated_to_id: { type: DataTypes.UUID }
  }, {
    tableName: 'support_tickets',
    underscored: true,
    paranoid: true
  });

  SupportTicket.associate = (models) => {
    SupportTicket.belongsTo(models.Partner, { foreignKey: 'partner_id', as: 'partner' });
    SupportTicket.belongsTo(models.User, { foreignKey: 'created_by_user_id', as: 'creator' });
    SupportTicket.belongsTo(models.User, { foreignKey: 'assigned_to_id', as: 'assignee' });
    SupportTicket.belongsTo(models.User, { foreignKey: 'escalated_to_id', as: 'escalatedTo' });
    SupportTicket.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    SupportTicket.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    SupportTicket.hasMany(models.SupportTicketComment, { foreignKey: 'ticket_id', as: 'comments' });
    SupportTicket.hasMany(models.SupportTicketStatusHistory, { foreignKey: 'ticket_id', as: 'history' });
  };

  return SupportTicket;
};
