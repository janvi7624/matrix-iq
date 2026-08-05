module.exports = (sequelize, DataTypes) => {
  const CustomModuleField = sequelize.define('CustomModuleField', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    customModuleId: { type: DataTypes.UUID, allowNull: false },
    label: { type: DataTypes.STRING },
    type: {
      type: DataTypes.ENUM(
        'text', 'number', 'currency', 'date', 'time', 'dropdown', 'multiselect',
        'checkbox', 'radio', 'textarea', 'richtext', 'email', 'phone', 'file',
        'image', 'user', 'project', 'product'
      )
    },
    required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Dropdown / multiselect / radio choices.
    options: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'custom_module_fields',
    underscored: false,
    paranoid: false
  });

  CustomModuleField.associate = (models) => {
    CustomModuleField.belongsTo(models.CustomModule, { foreignKey: 'customModuleId', as: 'customModule' });
  };

  return CustomModuleField;
};
