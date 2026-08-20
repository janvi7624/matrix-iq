'use strict';

/**
 * TMS (Technical Management System) — a net-new, Robotics/AI/AV/Marketing-only
 * module (see AGENTS.md-adjacent plan doc for the full spec):
 *   1. module_config.visibleToDepartments (JSONB) — optional department gate
 *      layered on top of the existing visibleToRoles; empty/absent means
 *      unrestricted, so every pre-existing module row is entirely unaffected.
 *   2. tms_projects / tms_tasks / tms_bom_requests / tms_procurement — the 4
 *      new tables. Deliberately separate from `projects` (the sales
 *      pipeline) — a TMS project is a technical-execution entity with its
 *      own unrelated lifecycle. Relationship chain: tms_projects ->
 *      tms_tasks / tms_bom_requests -> tms_procurement.
 *   No hours/estimated-hours/billable/timesheet column exists anywhere here
 *   by design — TMS explicitly does not do time tracking.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const idColumn = () => ({ id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false } });
    const timestamps = () => ({
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });
    const userFk = () => ({ type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });
    const deptFk = (allowNull = true) => ({ type: Sequelize.UUID, allowNull, references: { model: 'departments', key: 'id' }, onDelete: allowNull ? 'SET NULL' : 'RESTRICT', onUpdate: 'CASCADE' });

    await queryInterface.addColumn('module_config', 'visibleToDepartments', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });

    await queryInterface.createTable('tms_projects', {
      ...idColumn(),
      project_code: { type: Sequelize.STRING, unique: true },
      name: { type: Sequelize.STRING, allowNull: false },
      client_name: { type: Sequelize.STRING },
      client_contact: { type: Sequelize.TEXT },
      description: { type: Sequelize.TEXT },
      department_id: deptFk(false),
      project_manager_id: userFk(),
      team_member_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      start_date: { type: Sequelize.DATEONLY },
      estimated_close_date: { type: Sequelize.DATEONLY },
      actual_close_date: { type: Sequelize.DATEONLY },
      budget: { type: Sequelize.DECIMAL(14, 2) },
      status: { type: Sequelize.ENUM('planning', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'), allowNull: false, defaultValue: 'planning' },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
      progress_percent: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_by: userFk(),
      ...timestamps()
    });
    await queryInterface.addIndex('tms_projects', ['department_id']);
    await queryInterface.addIndex('tms_projects', ['status']);

    await queryInterface.createTable('tms_tasks', {
      ...idColumn(),
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_projects', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      name: { type: Sequelize.STRING, allowNull: false },
      assignee_id: userFk(),
      department_id: deptFk(true),
      description: { type: Sequelize.TEXT },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
      status: { type: Sequelize.ENUM('to_do', 'in_progress', 'on_hold', 'completed', 'cancelled'), allowNull: false, defaultValue: 'to_do' },
      start_date: { type: Sequelize.DATEONLY },
      due_date: { type: Sequelize.DATEONLY },
      completion_date: { type: Sequelize.DATEONLY },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_by: userFk(),
      ...timestamps()
    });
    await queryInterface.addIndex('tms_tasks', ['project_id']);
    await queryInterface.addIndex('tms_tasks', ['assignee_id']);
    await queryInterface.addIndex('tms_tasks', ['status']);
    await queryInterface.addIndex('tms_tasks', ['due_date']);

    await queryInterface.createTable('tms_bom_requests', {
      ...idColumn(),
      bom_request_code: { type: Sequelize.STRING, unique: true },
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_projects', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      requested_by_id: userFk(),
      department_id: deptFk(true),
      request_date: { type: Sequelize.DATEONLY },
      required_date: { type: Sequelize.DATEONLY },
      item_name: { type: Sequelize.STRING },
      item_description: { type: Sequelize.TEXT },
      part_number: { type: Sequelize.STRING },
      quantity: { type: Sequelize.INTEGER },
      specification: { type: Sequelize.TEXT },
      preferred_brand: { type: Sequelize.STRING },
      estimated_cost: { type: Sequelize.DECIMAL(14, 2) },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      status: { type: Sequelize.ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'sent_for_procurement', 'completed'), allowNull: false, defaultValue: 'draft' },
      rejection_reason: { type: Sequelize.TEXT },
      reviewed_by_id: userFk(),
      reviewed_at: { type: Sequelize.DATE },
      created_by: userFk(),
      ...timestamps()
    });
    await queryInterface.addIndex('tms_bom_requests', ['project_id']);
    await queryInterface.addIndex('tms_bom_requests', ['status']);

    await queryInterface.createTable('tms_procurement', {
      ...idColumn(),
      procurement_code: { type: Sequelize.STRING, unique: true },
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_projects', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      bom_request_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'tms_bom_requests', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      item_name: { type: Sequelize.STRING },
      part_number: { type: Sequelize.STRING },
      quantity: { type: Sequelize.INTEGER },
      vendor: { type: Sequelize.STRING },
      estimated_cost: { type: Sequelize.DECIMAL(14, 2) },
      quoted_cost: { type: Sequelize.DECIMAL(14, 2) },
      final_cost: { type: Sequelize.DECIMAL(14, 2) },
      request_date: { type: Sequelize.DATEONLY },
      required_date: { type: Sequelize.DATEONLY },
      expected_delivery_date: { type: Sequelize.DATEONLY },
      actual_delivery_date: { type: Sequelize.DATEONLY },
      purchase_status: { type: Sequelize.ENUM('requested', 'quotation_required', 'quotation_received', 'approval_pending', 'approved', 'po_created', 'ordered', 'cancelled'), allowNull: false, defaultValue: 'requested' },
      delivery_status: { type: Sequelize.ENUM('pending', 'partially_received', 'received', 'cancelled'), allowNull: false, defaultValue: 'pending' },
      remarks: { type: Sequelize.TEXT },
      documents: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_by: userFk(),
      ...timestamps()
    });
    await queryInterface.addIndex('tms_procurement', ['project_id']);
    await queryInterface.addIndex('tms_procurement', ['bom_request_id']);
    await queryInterface.addIndex('tms_procurement', ['purchase_status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tms_procurement');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_procurement_purchase_status"; DROP TYPE IF EXISTS "enum_tms_procurement_delivery_status";');
    await queryInterface.dropTable('tms_bom_requests');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_bom_requests_status";');
    await queryInterface.dropTable('tms_tasks');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_tasks_priority"; DROP TYPE IF EXISTS "enum_tms_tasks_status";');
    await queryInterface.dropTable('tms_projects');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_projects_status"; DROP TYPE IF EXISTS "enum_tms_projects_priority";');
    await queryInterface.removeColumn('module_config', 'visibleToDepartments');
  }
};
