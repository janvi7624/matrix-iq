// Accounts Payment Queue — see db/migrations/20260912180000-create-payment-holds.js
// for why this is an overlay table rather than a status value threaded into
// each source's own state machine.
module.exports = (sequelize, DataTypes) => {
  const PaymentHold = sequelize.define('PaymentHold', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    source: { type: DataTypes.STRING(30), allowNull: false },
    source_id: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    held_by: { type: DataTypes.UUID, allowNull: false },
    held_at: { type: DataTypes.DATE, allowNull: false },
    resumed_by: { type: DataTypes.UUID },
    resumed_at: { type: DataTypes.DATE },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'payment_holds',
    underscored: true,
    paranoid: false
  });

  PaymentHold.associate = (models) => {
    PaymentHold.belongsTo(models.User, { foreignKey: 'held_by', as: 'holder' });
    PaymentHold.belongsTo(models.User, { foreignKey: 'resumed_by', as: 'resumer' });
  };

  return PaymentHold;
};
