'use strict';

// Company-wide Indian festival greetings — HR-managed. See the migration
// (20261109143000-create-festivals.js) for the full design rationale.
module.exports = (sequelize, DataTypes) => {
  const Festival = sequelize.define('Festival', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING(60), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    greeting: { type: DataTypes.TEXT, allowNull: false },
    provisional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_by: { type: DataTypes.UUID },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'festivals',
    underscored: true,
    paranoid: false
  });

  Festival.associate = (models) => {
    Festival.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Festival.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updater' });
  };

  return Festival;
};
