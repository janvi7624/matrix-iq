module.exports = (sequelize, DataTypes) => {
  const Project = sequelize.define('Project', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    client_name: { type: DataTypes.STRING },
    company: { type: DataTypes.STRING },
    contact_person: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    // Free text — team rosters aren't real accounts per app comment, no FK.
    sales_person: { type: DataTypes.STRING },
    source: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('active', 'on_hold', 'won', 'lost'), allowNull: false, defaultValue: 'active' },
    stage: {
      type: DataTypes.ENUM(
        'site_visit', 'quotation', 'demo', 'customer_response', 'negotiation',
        'po_received', 'installation', 'completed', 'closed_lost'
      ),
      allowNull: false,
      defaultValue: 'site_visit'
    },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
    expected_closing_date: { type: DataTypes.DATEONLY },
    next_follow_up_date: { type: DataTypes.DATEONLY },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.UUID },
    assigned_technical_person_id: { type: DataTypes.UUID }
  }, {
    tableName: 'projects',
    underscored: true,
    paranoid: true
  });

  Project.associate = (models) => {
    Project.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Project.belongsTo(models.User, { foreignKey: 'assigned_technical_person_id', as: 'assignedTechnicalPersonRef' });
    Project.hasMany(models.ProjectNote, { foreignKey: 'project_id', as: 'notes' });
    Project.hasMany(models.ProjectTimelineEvent, { foreignKey: 'project_id', as: 'timeline' });
    Project.hasMany(models.Lead, { foreignKey: 'project_id', as: 'leads' });
    Project.hasMany(models.SiteVisit, { foreignKey: 'project_id', as: 'siteVisits' });
    Project.hasMany(models.Quotation, { foreignKey: 'project_id', as: 'quotations' });
    Project.hasMany(models.DemoSchedule, { foreignKey: 'project_id', as: 'demoSchedules' });
    Project.hasMany(models.CustomerResponse, { foreignKey: 'project_id', as: 'customerResponses' });
    Project.hasMany(models.Negotiation, { foreignKey: 'project_id', as: 'negotiations' });
    Project.hasMany(models.PurchaseOrder, { foreignKey: 'project_id', as: 'purchaseOrders' });
    Project.hasMany(models.Installation, { foreignKey: 'project_id', as: 'installations' });
    Project.hasMany(models.DeliveryChallan, { foreignKey: 'project_id', as: 'deliveryChallans' });
    Project.hasMany(models.MarketingRequest, { foreignKey: 'project_id', as: 'marketingRequests' });
  };

  return Project;
};
