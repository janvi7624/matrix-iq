module.exports = (sequelize, DataTypes) => {
  const ModuleConfig = sequelize.define('ModuleConfig', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING, unique: true },
    label: { type: DataTypes.STRING },
    // `desc` is fine as a Postgres column name since Sequelize quotes identifiers.
    desc: { type: DataTypes.STRING },
    icon: { type: DataTypes.STRING },
    href: { type: DataTypes.STRING },
    section: { type: DataTypes.STRING },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isCustom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    visibleToRoles: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'module_config',
    underscored: false,
    paranoid: false
  });

  return ModuleConfig;
};
