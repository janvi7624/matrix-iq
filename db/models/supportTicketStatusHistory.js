// Append-only status trail. Doubles as the input to the SLA pause
// calculation — lib/supportSla.ts walks it to work out how long the clock
// was stopped awaiting the partner.
module.exports = (sequelize, DataTypes) => {
  const SupportTicketStatusHistory = sequelize.define('SupportTicketStatusHistory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    ticket_id: { type: DataTypes.UUID, allowNull: false },
    from_status: { type: DataTypes.STRING(30) },
    to_status: { type: DataTypes.STRING(30), allowNull: false },
    by_user_id: { type: DataTypes.UUID },
    reason: { type: DataTypes.TEXT },
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'support_ticket_status_history',
    underscored: true,
    timestamps: false,
    paranoid: false
  });

  SupportTicketStatusHistory.associate = (models) => {
    SupportTicketStatusHistory.belongsTo(models.SupportTicket, { foreignKey: 'ticket_id', as: 'ticket' });
    SupportTicketStatusHistory.belongsTo(models.User, { foreignKey: 'by_user_id', as: 'actor' });
  };

  return SupportTicketStatusHistory;
};
