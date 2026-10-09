module.exports = (sequelize, DataTypes) => {
  const MaterialFolder = sequelize.define('MaterialFolder', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    // Null = a top-level folder. Self-referencing, so folders nest — the
    // depth cap and no-cycles rule are enforced in lib/materialFolderTree.ts,
    // which the schema can't express.
    parent_id: { type: DataTypes.UUID, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    updated_by: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'material_folders',
    underscored: true,
    paranoid: true
  });

  MaterialFolder.associate = (models) => {
    MaterialFolder.belongsTo(models.MaterialFolder, { foreignKey: 'parent_id', as: 'parent' });
    MaterialFolder.hasMany(models.MaterialFolder, { foreignKey: 'parent_id', as: 'children' });
    MaterialFolder.hasMany(models.Material, { foreignKey: 'folder_id', as: 'materials' });
  };

  return MaterialFolder;
};
