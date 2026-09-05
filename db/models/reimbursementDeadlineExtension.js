module.exports = (sequelize, DataTypes) => {
  const ReimbursementDeadlineExtension = sequelize.define('ReimbursementDeadlineExtension', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    month: { type: DataTypes.INTEGER, allowNull: false },
    extended_to_day: { type: DataTypes.INTEGER, allowNull: false },
    extended_by: { type: DataTypes.UUID }
  }, {
    tableName: 'reimbursement_deadline_extensions',
    underscored: true,
    paranoid: false,
    updatedAt: false
  });

  ReimbursementDeadlineExtension.associate = (models) => {
    ReimbursementDeadlineExtension.belongsTo(models.User, { foreignKey: 'extended_by', as: 'extendedByUser' });
  };

  return ReimbursementDeadlineExtension;
};
