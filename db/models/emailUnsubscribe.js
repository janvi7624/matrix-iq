'use strict';

// Addresses that opted out of bulk client mail (festival greetings).
module.exports = (sequelize, DataTypes) => {
  const EmailUnsubscribe = sequelize.define('EmailUnsubscribe', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    email: { type: DataTypes.STRING(320), allowNull: false },
    source: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'festival' }
  }, {
    tableName: 'email_unsubscribes',
    underscored: true,
    paranoid: false
  });

  return EmailUnsubscribe;
};
