// One message on a ticket. is_internal DEFAULTS TO TRUE — see the
// 20261020101000 migration. Partner-visible is always the deliberate act.
module.exports = (sequelize, DataTypes) => {
  const SupportTicketComment = sequelize.define('SupportTicketComment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    ticket_id: { type: DataTypes.UUID, allowNull: false },
    author_user_id: { type: DataTypes.UUID },
    body: { type: DataTypes.TEXT, allowNull: false },
    is_internal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'support_ticket_comments',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: false
  });

  SupportTicketComment.associate = (models) => {
    SupportTicketComment.belongsTo(models.SupportTicket, { foreignKey: 'ticket_id', as: 'ticket' });
    SupportTicketComment.belongsTo(models.User, { foreignKey: 'author_user_id', as: 'author' });
  };

  return SupportTicketComment;
};
