module.exports = (sequelize, DataTypes) => {
  const MarketingRequest = sequelize.define('MarketingRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    // Who is actively working the ticket in marketing
    assigned_to_id: { type: DataTypes.UUID },
    // Who is selected as the technical reviewer
    technical_assigned_to_id: { type: DataTypes.UUID },
    technical_assigned_to: { type: DataTypes.TEXT, defaultValue: '' },
    title: { type: DataTypes.STRING },
    product_category: { type: DataTypes.STRING },
    product_categories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    request_type: {
      type: DataTypes.STRING,
      defaultValue: 'other'
    },
    description: { type: DataTypes.TEXT },
    additional_info: { type: DataTypes.TEXT },
    priority: { type: DataTypes.STRING, allowNull: false, defaultValue: 'medium' },
    needed_by_date: { type: DataTypes.DATEONLY },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'submitted'
    },
    // Marketing workspace content and instructions for Technical
    marketing_prepared_content: { type: DataTypes.TEXT, defaultValue: '' },
    marketing_attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    marketing_remarks: { type: DataTypes.TEXT, defaultValue: '' },
    technical_instructions: { type: DataTypes.TEXT, defaultValue: '' },
    // Technical review feedback and decision
    technical_review_decision: { type: DataTypes.STRING, defaultValue: '' },
    technical_remarks: { type: DataTypes.TEXT, defaultValue: '' },
    technical_reviewed_at: { type: DataTypes.DATE },
    technical_reviewed_by: { type: DataTypes.STRING, defaultValue: '' },
    // Assignment acceptance gate — see lib/types.ts's MarketingRequestRecord
    // comment for the full rule.
    assignment_status: { type: DataTypes.STRING, defaultValue: '' },
    assignment_decline_reason: { type: DataTypes.TEXT, defaultValue: '' },
    // Final deliverables to the original requester
    final_submission_notes: { type: DataTypes.TEXT, defaultValue: '' },
    final_submission_files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Legacy fields kept for compatibility
    timeline: { type: DataTypes.JSONB },
    rejection_reason: { type: DataTypes.TEXT },
    completion_notes: { type: DataTypes.TEXT },
    delivered_files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'marketing_requests',
    underscored: true,
    paranoid: true
  });

  MarketingRequest.associate = (models) => {
    MarketingRequest.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    MarketingRequest.belongsTo(models.User, { foreignKey: 'assigned_to_id', as: 'assignee' });
    MarketingRequest.belongsTo(models.User, { foreignKey: 'technical_assigned_to_id', as: 'technicalMember' });
    MarketingRequest.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    MarketingRequest.hasMany(models.MarketingRequestComment, { foreignKey: 'marketing_request_id', as: 'comments' });
  };

  return MarketingRequest;
};
