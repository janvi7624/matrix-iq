module.exports = (sequelize, DataTypes) => {
  const MetaIntegrationConfig = sequelize.define('MetaIntegrationConfig', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    webhook_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    last_connection_test_at: { type: DataTypes.DATE },
    last_connection_test_ok: { type: DataTypes.BOOLEAN },
    last_connection_test_message: { type: DataTypes.TEXT },
    last_webhook_received_at: { type: DataTypes.DATE },
    last_successful_sync_at: { type: DataTypes.DATE },
    // 'fixed' | 'round_robin' | 'campaign'
    assignment_mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'fixed' },
    default_department_id: { type: DataTypes.UUID },
    default_owner_id: { type: DataTypes.UUID },
    round_robin_pool: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    round_robin_cursor: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    campaign_routing_map: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    updated_by_id: { type: DataTypes.UUID }
  }, {
    tableName: 'meta_integration_configs',
    underscored: true,
    paranoid: false,
    createdAt: false
  });

  MetaIntegrationConfig.associate = (models) => {
    MetaIntegrationConfig.belongsTo(models.Department, { foreignKey: 'default_department_id', as: 'defaultDepartment' });
    MetaIntegrationConfig.belongsTo(models.User, { foreignKey: 'default_owner_id', as: 'defaultOwner' });
    MetaIntegrationConfig.belongsTo(models.User, { foreignKey: 'updated_by_id', as: 'updatedBy' });
  };

  return MetaIntegrationConfig;
};
