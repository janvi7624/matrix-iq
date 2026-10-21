// Response/resolution targets per priority. Configuration, not constants —
// these are a commercial commitment that changes. See the 20261020102000
// migration.
module.exports = (sequelize, DataTypes) => {
  const SupportSlaPolicy = sequelize.define('SupportSlaPolicy', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    priority: { type: DataTypes.STRING(10), allowNull: false },
    first_response_minutes: { type: DataTypes.INTEGER, allowNull: false },
    resolution_minutes: { type: DataTypes.INTEGER, allowNull: false },
    // The documented pause rule: the clock stops while we are waiting on the
    // partner, so the metric measures our responsiveness, not theirs.
    pause_on_awaiting_partner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Reserved — needs a working calendar this app does not have. See the migration.
    business_hours_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    escalate_after_minutes: { type: DataTypes.INTEGER },
    escalate_to_user_id: { type: DataTypes.UUID },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' }
  }, {
    tableName: 'support_sla_policies',
    underscored: true,
    paranoid: false
  });

  SupportSlaPolicy.associate = (models) => {
    SupportSlaPolicy.belongsTo(models.User, { foreignKey: 'escalate_to_user_id', as: 'escalateTo' });
  };

  return SupportSlaPolicy;
};
