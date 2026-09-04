'use strict';

// Static requires instead of sequelize-cli's default fs.readdirSync +
// dynamic require(path.join(__dirname, file)) — Next.js/Turbopack bundles
// this file for every route/page that touches the store layer (via
// lib/db.ts) and can't statically follow a dynamic require of sibling files
// in the same directory ("server relative imports are not implemented yet").
// sequelize-cli itself (npm run db:migrate) doesn't go through a bundler, so
// this only needed to change for the app's own runtime, not migrations.
const Sequelize = require('sequelize');
const config = require('../config/config.js')[process.env.NODE_ENV || 'development'];

const modelDefiners = [
  require('./role.js'),
  require('./user.js'),
  require('./department.js'),
  require('./project.js'),
  require('./projectNote.js'),
  require('./projectTimelineEvent.js'),
  require('./lead.js'),
  require('./siteVisit.js'),
  require('./siteVisitUpdate.js'),
  require('./quotation.js'),
  require('./quotationProduct.js'),
  require('./quotationFollowUp.js'),
  require('./demoSchedule.js'),
  require('./demoProductLine.js'),
  require('./customerResponse.js'),
  require('./negotiation.js'),
  require('./purchaseOrder.js'),
  require('./installation.js'),
  require('./deliveryChallan.js'),
  require('./deliveryChallanItem.js'),
  require('./productCategory.js'),
  require('./product.js'),
  require('./productPricing.js'),
  require('./productCatalogOverride.js'),
  require('./travelSchedule.js'),
  require('./marketingRequest.js'),
  require('./marketingRequestComment.js'),
  require('./tmsProject.js'),
  require('./tmsTask.js'),
  require('./tmsBomRequest.js'),
  require('./tmsProcurement.js'),
  require('./auditLog.js'),
  require('./loginHistory.js'),
  require('./moduleConfig.js'),
  require('./customModule.js'),
  require('./customModuleField.js'),
  require('./customModuleRecord.js'),
  require('./appConfig.js'),
  require('./attachment.js'),
  require('./notification.js'),
  require('./projectHandoverRequest.js'),
  require('./reimbursement.js'),
  require('./reimbursementSheet.js'),
  require('./officeOperationExpense.js'),
  require('./metaIntegrationConfig.js'),
  require('./metaWebhookEvent.js'),
  require('./salesTarget.js')
];

const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else if (config.url) {
  sequelize = new Sequelize(config.url, config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

for (const define of modelDefiners) {
  const model = define(sequelize, Sequelize.DataTypes);
  db[model.name] = model;
}

Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
