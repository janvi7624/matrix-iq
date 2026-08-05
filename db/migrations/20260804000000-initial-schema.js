'use strict';

/**
 * Creates all 33 tables for the nantaos schema, in dependency order (parents
 * before children/FK targets). The one circular reference in the schema —
 * `roles.createdBy/updatedBy` -> `users.id` while `users.roleId` -> `roles.id`
 * — is resolved by creating `roles` first with plain (unreferenced) UUID
 * columns, creating `users` next with its FK to `roles`, then adding the
 * `roles` -> `users` FK constraints afterward.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const idColumn = () => ({
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      }
    });

    // Sequelize's automatic bookkeeping timestamp columns, matching each
    // model's `underscored`/`paranoid` options.
    const timestamps = ({ underscored, paranoid, createdAtOnly } = {}) => {
      const createdAtKey = underscored ? 'created_at' : 'createdAt';
      const updatedAtKey = underscored ? 'updated_at' : 'updatedAt';
      const deletedAtKey = underscored ? 'deleted_at' : 'deletedAt';
      const cols = {
        [createdAtKey]: { type: Sequelize.DATE, allowNull: false }
      };
      if (!createdAtOnly) {
        cols[updatedAtKey] = { type: Sequelize.DATE, allowNull: false };
      }
      if (paranoid) {
        cols[deletedAtKey] = { type: Sequelize.DATE, allowNull: true };
      }
      return cols;
    };

    // Standard shape for every created_by/createdBy & updated_by/updatedBy
    // audit FK per the audit-FK convention: nullable, SET NULL on delete.
    const userFk = () => ({
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // ---------------------------------------------------------------------
    // Auth & access
    // ---------------------------------------------------------------------
    await queryInterface.createTable('roles', {
      ...idColumn(),
      key: { type: Sequelize.STRING, allowNull: false },
      label: { type: Sequelize.STRING },
      description: { type: Sequelize.TEXT },
      isSystem: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isPrivileged: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      permissions: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // FK constraints to `users` are added below, once `users` exists.
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      ...timestamps({ underscored: false, paranoid: true })
    });
    await queryInterface.addIndex('roles', ['key'], { unique: true, name: 'roles_key_unique' });

    await queryInterface.createTable('users', {
      ...idColumn(),
      username: { type: Sequelize.STRING, allowNull: false },
      passwordHash: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      email: { type: Sequelize.STRING },
      roleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
      },
      employeeId: { type: Sequelize.STRING },
      department: { type: Sequelize.STRING },
      designation: { type: Sequelize.STRING },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      lastLoginAt: { type: Sequelize.DATE },
      ...timestamps({ underscored: false, paranoid: true })
    });
    await queryInterface.addIndex('users', ['username'], { unique: true, name: 'users_username_unique' });

    await queryInterface.addConstraint('roles', {
      fields: ['createdBy'],
      type: 'foreign key',
      name: 'roles_createdBy_fkey',
      references: { table: 'users', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addConstraint('roles', {
      fields: ['updatedBy'],
      type: 'foreign key',
      name: 'roles_updatedBy_fkey',
      references: { table: 'users', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.createTable('departments', {
      ...idColumn(),
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      description: { type: Sequelize.TEXT },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      createdBy: userFk(),
      updatedBy: userFk(),
      ...timestamps({ underscored: false, paranoid: true })
    });

    // ---------------------------------------------------------------------
    // Sales pipeline hub
    // ---------------------------------------------------------------------
    await queryInterface.createTable('projects', {
      ...idColumn(),
      client_name: { type: Sequelize.STRING },
      company: { type: Sequelize.STRING },
      contact_person: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      email: { type: Sequelize.STRING },
      address: { type: Sequelize.STRING },
      sales_person: { type: Sequelize.STRING },
      source: { type: Sequelize.STRING },
      status: { type: Sequelize.ENUM('active', 'on_hold', 'won', 'lost'), allowNull: false, defaultValue: 'active' },
      stage: {
        type: Sequelize.ENUM(
          'site_visit', 'quotation', 'demo', 'customer_response', 'negotiation',
          'po_received', 'installation', 'completed', 'closed_lost'
        ),
        allowNull: false,
        defaultValue: 'site_visit'
      },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
      expected_closing_date: { type: Sequelize.DATEONLY },
      next_follow_up_date: { type: Sequelize.DATEONLY },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_by: userFk(),
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('project_notes', {
      ...idColumn(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      at: { type: Sequelize.DATE },
      by: { type: Sequelize.STRING },
      text: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: false })
    });

    await queryInterface.createTable('project_timeline_events', {
      ...idColumn(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      at: { type: Sequelize.DATE },
      by: { type: Sequelize.STRING },
      stage: { type: Sequelize.STRING },
      label: { type: Sequelize.STRING },
      remarks: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Leads
    // ---------------------------------------------------------------------
    await queryInterface.createTable('leads', {
      ...idColumn(),
      created_by: userFk(),
      name: { type: Sequelize.STRING },
      mobile: { type: Sequelize.STRING },
      email: { type: Sequelize.STRING },
      designation: { type: Sequelize.STRING },
      company: { type: Sequelize.STRING },
      city: { type: Sequelize.STRING },
      card_image_url: { type: Sequelize.STRING },
      interests: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      sub_interests: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      priority: { type: Sequelize.ENUM('hot', 'warm', 'cool') },
      follow_up_actions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      budget: { type: Sequelize.STRING },
      notes: { type: Sequelize.TEXT },
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      ...timestamps({ underscored: true, paranoid: true })
    });

    // ---------------------------------------------------------------------
    // Site visits
    // ---------------------------------------------------------------------
    await queryInterface.createTable('site_visits', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      company_name: { type: Sequelize.STRING },
      contact_person: { type: Sequelize.STRING },
      client_email: { type: Sequelize.STRING },
      client_phone: { type: Sequelize.STRING },
      location: { type: Sequelize.STRING },
      visit_date: { type: Sequelize.DATEONLY },
      team_technical: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      team_sales: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      purpose: { type: Sequelize.TEXT },
      category: { type: Sequelize.STRING },
      products_interested: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      visit_details: { type: Sequelize.TEXT },
      image_urls: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      action_plan: { type: Sequelize.TEXT },
      reminder_date: { type: Sequelize.DATEONLY },
      stage: { type: Sequelize.ENUM('hot', 'warm', 'cold') },
      status: { type: Sequelize.ENUM('open', 'closed'), allowNull: false, defaultValue: 'open' },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('site_visit_updates', {
      ...idColumn(),
      site_visit_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'site_visits', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      // Business field (when this update entry was logged) — the model
      // disables Sequelize's automatic `updatedAt` to avoid colliding with it.
      updated_at: { type: Sequelize.DATE },
      updated_by: { type: Sequelize.STRING },
      team_technical: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      team_sales: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      project_details: { type: Sequelize.TEXT },
      ongoing_activities: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: false, createdAtOnly: true })
    });

    // ---------------------------------------------------------------------
    // Quotations
    // ---------------------------------------------------------------------
    await queryInterface.createTable('quotations', {
      ...idColumn(),
      quotation_number: { type: Sequelize.STRING, allowNull: false },
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      created_by: userFk(),
      status: { type: Sequelize.ENUM('draft', 'sent', 'approved', 'rejected'), allowNull: false, defaultValue: 'draft' },
      prepared_by: { type: Sequelize.STRING },
      prepared_by_phone: { type: Sequelize.STRING },
      prepared_by_email: { type: Sequelize.STRING },
      client_name: { type: Sequelize.STRING },
      client_company: { type: Sequelize.STRING },
      client_email: { type: Sequelize.STRING },
      client_phone: { type: Sequelize.STRING },
      client_address: { type: Sequelize.STRING },
      project_vertical: { type: Sequelize.STRING },
      domain_summary: { type: Sequelize.TEXT },
      products_summary: { type: Sequelize.TEXT },
      products_json: { type: Sequelize.JSONB },
      subtotal: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      markup_percent: { type: Sequelize.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },
      discount_total: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      gst_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      total: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      validity_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_follow_up_at: { type: Sequelize.DATE },
      // Self-referential — points at the ROOT quotation for a revision.
      original_quotation_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'quotations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      revision_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      revision_reason: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: true })
    });
    await queryInterface.addIndex('quotations', ['quotation_number'], { unique: true, name: 'quotations_quotation_number_unique' });

    await queryInterface.createTable('quotation_products', {
      ...idColumn(),
      quotation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quotations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      domain_key: { type: Sequelize.STRING },
      label: { type: Sequelize.STRING },
      description: { type: Sequelize.STRING },
      qty: { type: Sequelize.DECIMAL(12, 2) },
      rate: { type: Sequelize.DECIMAL(14, 2) },
      amount: { type: Sequelize.DECIMAL(14, 2) },
      unit: { type: Sequelize.STRING },
      remark: { type: Sequelize.TEXT },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps({ underscored: true, paranoid: false })
    });

    await queryInterface.createTable('quotation_follow_ups', {
      ...idColumn(),
      quotation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quotations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      note: { type: Sequelize.TEXT },
      created_by: { type: Sequelize.STRING },
      ...timestamps({ underscored: true, paranoid: false, createdAtOnly: true })
    });

    // ---------------------------------------------------------------------
    // Demo scheduling
    // ---------------------------------------------------------------------
    await queryInterface.createTable('demo_schedule', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      quotation_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'quotations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      client_name: { type: Sequelize.STRING },
      company: { type: Sequelize.STRING },
      location: { type: Sequelize.STRING },
      product_domains: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      products_demonstrated: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
      assigned_technical_person: { type: Sequelize.STRING },
      technical_members: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      scheduled_at: { type: Sequelize.DATE },
      assigned_rep: { type: Sequelize.STRING },
      status: {
        type: Sequelize.ENUM(
          'draft', 'pending_technical', 'pending_manager', 'pending_backoffice',
          'dc_generated', 'material_dispatched', 'demo_completed', 'material_returned',
          'dc_closed', 'cancelled'
        ),
        allowNull: false,
        defaultValue: 'draft'
      },
      technical_approval: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      manager_approval: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      notes: { type: Sequelize.TEXT },
      demo_objective: { type: Sequelize.TEXT },
      outcome: { type: Sequelize.ENUM('successful', 'need_followup', 'pending_decision', 'cancelled') },
      customer_rating: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      key_queries: { type: Sequelize.TEXT },
      technical_challenges: { type: Sequelize.TEXT },
      unanswered_queries: { type: Sequelize.TEXT },
      suggested_next_action: { type: Sequelize.TEXT },
      next_follow_up_date: { type: Sequelize.DATEONLY },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('demo_product_lines', {
      ...idColumn(),
      demo_schedule_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'demo_schedule', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      product: { type: Sequelize.STRING },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps({ underscored: true, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Post-demo workflow
    // ---------------------------------------------------------------------
    await queryInterface.createTable('customer_responses', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      demo_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'demo_schedule', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      feedback: { type: Sequelize.TEXT },
      response_type: {
        type: Sequelize.ENUM('interested', 'not_interested', 'need_revision', 'need_new_quotation', 'budget_issue', 'competitor')
      },
      expected_decision_date: { type: Sequelize.DATEONLY },
      remarks: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('negotiations', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      discussion_date: { type: Sequelize.DATEONLY },
      person: { type: Sequelize.STRING },
      discussion: { type: Sequelize.TEXT },
      offer_given: { type: Sequelize.TEXT },
      discount: { type: Sequelize.STRING },
      revised_price: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      expected_closure: { type: Sequelize.DATEONLY },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('purchase_orders', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      po_number: { type: Sequelize.STRING },
      po_date: { type: Sequelize.DATEONLY },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      attachment_url: { type: Sequelize.STRING },
      advance_received: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      payment_terms: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('installations', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      installation_date: { type: Sequelize.DATEONLY },
      assigned_engineer: { type: Sequelize.STRING },
      status: { type: Sequelize.ENUM('scheduled', 'in_progress', 'completed'), allowNull: false, defaultValue: 'scheduled' },
      completion_report: { type: Sequelize.TEXT },
      client_signature: { type: Sequelize.STRING },
      ...timestamps({ underscored: true, paranoid: true })
    });

    // ---------------------------------------------------------------------
    // Back office / delivery challans
    // ---------------------------------------------------------------------
    await queryInterface.createTable('delivery_challans', {
      ...idColumn(),
      dc_number: { type: Sequelize.STRING, unique: true },
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      demo_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'demo_schedule', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
      },
      client_name: { type: Sequelize.STRING },
      issued_by: { type: Sequelize.STRING },
      issued_date: { type: Sequelize.DATEONLY },
      expected_return_date: { type: Sequelize.DATEONLY },
      assigned_engineer: { type: Sequelize.STRING },
      status: { type: Sequelize.ENUM('prepared', 'dispatched', 'returned', 'closed'), allowNull: false, defaultValue: 'prepared' },
      material_return: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      ...timestamps({ underscored: true, paranoid: true })
    });

    await queryInterface.createTable('delivery_challan_items', {
      ...idColumn(),
      delivery_challan_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_challans', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      product: { type: Sequelize.STRING },
      serial_number: { type: Sequelize.STRING },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps({ underscored: true, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Products
    // ---------------------------------------------------------------------
    await queryInterface.createTable('product_categories', {
      ...idColumn(),
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      description: { type: Sequelize.TEXT },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      createdBy: userFk(),
      updatedBy: userFk(),
      ...timestamps({ underscored: false, paranoid: true })
    });

    await queryInterface.createTable('products', {
      ...idColumn(),
      categoryId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'product_categories', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      name: { type: Sequelize.STRING },
      sku: { type: Sequelize.STRING, unique: true },
      category: { type: Sequelize.STRING },
      brand: { type: Sequelize.STRING },
      description: { type: Sequelize.TEXT },
      unit: { type: Sequelize.STRING },
      defaultQty: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      basePrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      sellingPrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      taxPercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      hsnSac: { type: Sequelize.STRING },
      discountPercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      imageUrl: { type: Sequelize.STRING },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      createdBy: userFk(),
      ...timestamps({ underscored: false, paranoid: true })
    });

    await queryInterface.createTable('product_pricing', {
      ...idColumn(),
      productId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'products', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      priceType: { type: Sequelize.ENUM('base', 'selling', 'tier') },
      price: { type: Sequelize.DECIMAL(14, 2) },
      effectiveFrom: { type: Sequelize.DATEONLY },
      effectiveTo: { type: Sequelize.DATEONLY },
      createdBy: userFk(),
      ...timestamps({ underscored: false, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Misc CRM
    // ---------------------------------------------------------------------
    await queryInterface.createTable('travel_schedule', {
      ...idColumn(),
      created_by: userFk(),
      origin: { type: Sequelize.STRING },
      destination: { type: Sequelize.STRING },
      start_date: { type: Sequelize.DATEONLY },
      end_date: { type: Sequelize.DATEONLY },
      purpose: { type: Sequelize.TEXT },
      linked_client: { type: Sequelize.STRING },
      expense_note: { type: Sequelize.TEXT },
      ...timestamps({ underscored: true, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Audit / logs
    // ---------------------------------------------------------------------
    await queryInterface.createTable('audit_logs', {
      ...idColumn(),
      at: { type: Sequelize.DATE },
      by: { type: Sequelize.STRING },
      actor_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      role: { type: Sequelize.STRING },
      entity_type: { type: Sequelize.ENUM('demo', 'delivery_challan', 'custom_module', 'lead', 'quotation') },
      // Polymorphic — intentionally NOT a real FK constraint, since entity_type
      // determines which table entity_id actually points into.
      entity_id: { type: Sequelize.UUID },
      action: { type: Sequelize.STRING },
      previous_status: { type: Sequelize.STRING },
      new_status: { type: Sequelize.STRING },
      remarks: { type: Sequelize.TEXT },
      ip: { type: Sequelize.STRING },
      ...timestamps({ underscored: true, paranoid: false })
    });
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], { name: 'audit_logs_entity_type_entity_id_idx' });
    await queryInterface.addIndex('audit_logs', ['at'], { name: 'audit_logs_at_idx' });

    await queryInterface.createTable('login_history', {
      ...idColumn(),
      username: { type: Sequelize.STRING },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      at: { type: Sequelize.DATE },
      success: { type: Sequelize.BOOLEAN },
      ip: { type: Sequelize.STRING },
      ...timestamps({ underscored: false, paranoid: false })
    });
    await queryInterface.addIndex('login_history', ['username'], { name: 'login_history_username_idx' });
    await queryInterface.addIndex('login_history', ['at'], { name: 'login_history_at_idx' });

    // ---------------------------------------------------------------------
    // Admin / config
    // ---------------------------------------------------------------------
    await queryInterface.createTable('module_config', {
      ...idColumn(),
      key: { type: Sequelize.STRING, unique: true },
      label: { type: Sequelize.STRING },
      desc: { type: Sequelize.STRING },
      icon: { type: Sequelize.STRING },
      href: { type: Sequelize.STRING },
      section: { type: Sequelize.STRING },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      isCustom: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      visibleToRoles: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      ...timestamps({ underscored: false, paranoid: false })
    });

    await queryInterface.createTable('custom_modules', {
      ...idColumn(),
      key: { type: Sequelize.STRING, unique: true },
      name: { type: Sequelize.STRING },
      icon: { type: Sequelize.STRING },
      section: { type: Sequelize.STRING },
      createdBy: userFk(),
      requiresApproval: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      approverRole: { type: Sequelize.STRING },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps({ underscored: false, paranoid: true })
    });

    await queryInterface.createTable('custom_module_fields', {
      ...idColumn(),
      customModuleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'custom_modules', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      label: { type: Sequelize.STRING },
      type: {
        type: Sequelize.ENUM(
          'text', 'number', 'currency', 'date', 'time', 'dropdown', 'multiselect',
          'checkbox', 'radio', 'textarea', 'richtext', 'email', 'phone', 'file',
          'image', 'user', 'project', 'product'
        )
      },
      required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      options: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps({ underscored: false, paranoid: false })
    });

    await queryInterface.createTable('custom_module_records', {
      ...idColumn(),
      customModuleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'custom_modules', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      createdBy: userFk(),
      status: { type: Sequelize.ENUM('active', 'pending_approval', 'approved', 'rejected'), allowNull: false, defaultValue: 'active' },
      values: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      ...timestamps({ underscored: false, paranoid: true })
    });

    await queryInterface.createTable('app_config', {
      ...idColumn(),
      companyName: { type: Sequelize.STRING },
      companyLegalName: { type: Sequelize.STRING },
      gstNumber: { type: Sequelize.STRING },
      panNumber: { type: Sequelize.STRING },
      addressLine1: { type: Sequelize.STRING },
      addressLine2: { type: Sequelize.STRING },
      addressLine3: { type: Sequelize.STRING },
      contactPhone: { type: Sequelize.STRING },
      contactEmail: { type: Sequelize.STRING },
      website: { type: Sequelize.STRING },
      bankAccountName: { type: Sequelize.STRING },
      bankAccountNumber: { type: Sequelize.STRING },
      bankIfsc: { type: Sequelize.STRING },
      bankName: { type: Sequelize.STRING },
      bankBranch: { type: Sequelize.STRING },
      currencyCode: { type: Sequelize.STRING },
      currencySymbol: { type: Sequelize.STRING },
      defaultTaxPercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      taxLabel: { type: Sequelize.STRING },
      quotationTerms: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      dcNumberPrefix: { type: Sequelize.STRING },
      notificationTemplates: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      updatedBy: userFk(),
      ...timestamps({ underscored: false, paranoid: false })
    });

    // ---------------------------------------------------------------------
    // Cross-cutting
    // ---------------------------------------------------------------------
    await queryInterface.createTable('attachments', {
      ...idColumn(),
      ownerType: { type: Sequelize.ENUM('project', 'custom_module_record', 'demo_schedule') },
      // Polymorphic — no FK constraint, since ownerType determines the target table.
      ownerId: { type: Sequelize.UUID },
      url: { type: Sequelize.STRING },
      fileName: { type: Sequelize.STRING },
      uploadedBy: userFk(),
      uploadedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('attachments', ['ownerType', 'ownerId'], { name: 'attachments_ownerType_ownerId_idx' });

    await queryInterface.createTable('notifications', {
      ...idColumn(),
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      title: { type: Sequelize.STRING },
      body: { type: Sequelize.TEXT },
      type: { type: Sequelize.STRING },
      entityType: { type: Sequelize.STRING },
      // Polymorphic — no FK constraint.
      entityId: { type: Sequelize.UUID },
      isRead: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps({ underscored: false, paranoid: false })
    });
    await queryInterface.addIndex('notifications', ['userId', 'isRead'], { name: 'notifications_userId_isRead_idx' });
  },

  async down(queryInterface /*, Sequelize */) {
    // Drop tables children-first (exact reverse of creation order).
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('attachments');
    await queryInterface.dropTable('app_config');
    await queryInterface.dropTable('custom_module_records');
    await queryInterface.dropTable('custom_module_fields');
    await queryInterface.dropTable('custom_modules');
    await queryInterface.dropTable('module_config');
    await queryInterface.dropTable('login_history');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('travel_schedule');
    await queryInterface.dropTable('product_pricing');
    await queryInterface.dropTable('products');
    await queryInterface.dropTable('product_categories');
    await queryInterface.dropTable('delivery_challan_items');
    await queryInterface.dropTable('delivery_challans');
    await queryInterface.dropTable('installations');
    await queryInterface.dropTable('purchase_orders');
    await queryInterface.dropTable('negotiations');
    await queryInterface.dropTable('customer_responses');
    await queryInterface.dropTable('demo_product_lines');
    await queryInterface.dropTable('demo_schedule');
    await queryInterface.dropTable('quotation_follow_ups');
    await queryInterface.dropTable('quotation_products');
    await queryInterface.dropTable('quotations');
    await queryInterface.dropTable('site_visit_updates');
    await queryInterface.dropTable('site_visits');
    await queryInterface.dropTable('leads');
    await queryInterface.dropTable('project_timeline_events');
    await queryInterface.dropTable('project_notes');
    await queryInterface.dropTable('projects');
    await queryInterface.dropTable('departments');

    // Must drop the roles -> users FK constraints before users can be dropped.
    await queryInterface.removeConstraint('roles', 'roles_createdBy_fkey');
    await queryInterface.removeConstraint('roles', 'roles_updatedBy_fkey');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('roles');

    // Postgres ENUM types are separate objects — dropping the table doesn't
    // drop the type. Drop them all, in reverse creation order, now that no
    // table column references them anymore.
    const enumTypes = [
      'enum_attachments_ownerType',
      'enum_custom_module_records_status',
      'enum_custom_module_fields_type',
      'enum_audit_logs_entity_type',
      'enum_product_pricing_priceType',
      'enum_products_status',
      'enum_product_categories_status',
      'enum_delivery_challans_status',
      'enum_installations_status',
      'enum_customer_responses_response_type',
      'enum_demo_schedule_outcome',
      'enum_demo_schedule_status',
      'enum_demo_schedule_priority',
      'enum_quotations_status',
      'enum_site_visits_status',
      'enum_site_visits_stage',
      'enum_leads_priority',
      'enum_projects_priority',
      'enum_projects_stage',
      'enum_projects_status',
      'enum_departments_status',
      'enum_users_status',
      'enum_roles_status'
    ];
    for (const typeName of enumTypes) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${typeName}";`);
    }
  }
};
