module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    at: { type: DataTypes.DATE },
    // Username, kept as-is since this is a point-in-time log.
    by: { type: DataTypes.STRING },
    // Best-effort resolved id alongside the `by` username string.
    actor_id: { type: DataTypes.UUID },
    role: { type: DataTypes.STRING },
    // Plain string (widened from a narrow ENUM in the 2026-08-06 migration)
    // so new auditable entity types never require a schema migration.
    entity_type: { type: DataTypes.STRING },
    // Polymorphic — intentionally NOT a real FK constraint since entity_type
    // determines which table entity_id points into.
    entity_id: { type: DataTypes.UUID },
    action: { type: DataTypes.STRING },
    previous_status: { type: DataTypes.STRING },
    new_status: { type: DataTypes.STRING },
    remarks: { type: DataTypes.TEXT },
    ip: { type: DataTypes.STRING }
  }, {
    tableName: 'audit_logs',
    underscored: true,
    paranoid: false
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.User, { foreignKey: 'actor_id', as: 'actor' });
  };

  return AuditLog;
};
