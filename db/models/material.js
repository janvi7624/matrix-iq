module.exports = (sequelize, DataTypes) => {
  const Material = sequelize.define('Material', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // What the material is FOR — the product, or the client on a case study.
    // The unit the library is browsed by.
    product: { type: DataTypes.STRING, allowNull: false },
    // One of lib/materialCategories.ts MATERIAL_CATEGORIES.
    category: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'other' },
    // The document's own name, when it differs from the product — "X200
    // Datasheet (Hindi)" under product "X200".
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    // Drive's id, parsed out of the pasted URL. Null when the link had no
    // recognisable id — the link is still worth keeping.
    drive_file_id: { type: DataTypes.STRING(128), allowNull: true },
    web_view_link: { type: DataTypes.TEXT, allowNull: false },
    // Whether the link opens a Drive FOLDER (everything for this product) or
    // a single file. Decides whether the button says "Open folder".
    is_folder: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Which library folder this sits in. Null = the top level, where
    // everything added before folders existed stays.
    folder_id: { type: DataTypes.UUID, allowNull: true },
    // 'drive' | 'upload' — which of the two "add a material" paths this row
    // came from. See 20261022110000-materials-upload-support.js for why this
    // reuses a column name a dropped feature once used for something else.
    source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'drive' },
    // The real content-type of an uploaded file (null for a Drive link,
    // where nothing here can read the file to know it).
    mime_type: { type: DataTypes.STRING(128), allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    updated_by: { type: DataTypes.UUID, allowNull: true },
    // Published to the Partner Portal. Default false — the library is
    // internal, and holds competitor comparisons and internal decks
    // alongside customer-facing brochures. See the 20261020097000 migration.
    partner_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // [] = every partner (once visible); a populated array = only those
    // partner ids.
    partner_audience: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'materials',
    underscored: true,
    paranoid: true
  });

  Material.associate = (models) => {
    Material.belongsTo(models.MaterialFolder, { foreignKey: 'folder_id', as: 'folder' });
    Material.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Material.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return Material;
};
