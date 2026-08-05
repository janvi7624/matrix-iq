module.exports = (sequelize, DataTypes) => {
  const Negotiation = sequelize.define('Negotiation', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    discussion_date: { type: DataTypes.DATEONLY },
    person: { type: DataTypes.STRING },
    discussion: { type: DataTypes.TEXT },
    offer_given: { type: DataTypes.TEXT },
    discount: { type: DataTypes.STRING },
    revised_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    expected_closure: { type: DataTypes.DATEONLY }
  }, {
    tableName: 'negotiations',
    underscored: true,
    paranoid: true
  });

  Negotiation.associate = (models) => {
    Negotiation.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Negotiation.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
  };

  return Negotiation;
};
