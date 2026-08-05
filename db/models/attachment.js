// Generic polymorphic file table. Most modules keep their attachment arrays
// as inline JSONB columns already defined on their own models (simpler,
// matches existing app code) — this table exists for the future/cross-cutting
// case where a dedicated attachments module is wired in; it is NOT yet
// referenced by any of the JSONB attachment fields on the other models.
module.exports = (sequelize, DataTypes) => {
  const Attachment = sequelize.define('Attachment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    ownerType: { type: DataTypes.ENUM('project', 'custom_module_record', 'demo_schedule') },
    // Polymorphic — no FK constraint, since ownerType determines the target table.
    ownerId: { type: DataTypes.UUID },
    url: { type: DataTypes.STRING },
    fileName: { type: DataTypes.STRING },
    uploadedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'attachments',
    underscored: false,
    paranoid: false,
    timestamps: true,
    createdAt: 'uploadedAt',
    updatedAt: false
  });

  Attachment.associate = (models) => {
    Attachment.belongsTo(models.User, { foreignKey: 'uploadedBy', as: 'uploader' });
  };

  return Attachment;
};
