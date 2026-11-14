'use strict';

/**
 * AI Sales Agent — Phase 1 schema (channel-agnostic AI layer).
 *
 * Five tables, no changes to any existing one. In particular `leads` is NOT
 * touched: `leads.priority` ('hot'|'warm'|'cool') stays the HUMAN-owned
 * field, and the AI's own band ('hot'|'warm'|'cold'|'unqualified') lives in
 * lead_ai_assessments. A user pressing "Accept" is what writes the human
 * field (cold -> cool; unqualified leaves priority alone and suggests a
 * call_outcome instead), which is why no enum migration is needed here.
 *
 * Creation order is FK order: ai_runs before lead_ai_assessments.
 *
 * Index/constraint notes, since several are load-bearing:
 *
 *  - Every unique index is PARTIAL on `deleted_at IS NULL`, matching
 *    sales_targets/materials: a soft-deleted row must never block a fresh
 *    one. The two partial uniques here also need an `IS NOT NULL` / boolean
 *    predicate that queryInterface.addIndex's `where` cannot express, so
 *    they are raw SQL — same approach as the GIN indexes in
 *    20261103140000-materials-role-visibility.js.
 *
 *  - lead_ai_assessments.ai_run_id is ON DELETE SET NULL, deliberately and
 *    NOT cascade. ai_runs is purged on a 90-day retention policy
 *    (/api/cron/ai-retention-purge, a hard delete); cascading would make
 *    that purge silently destroy every assessment older than the retention
 *    window — the lead's analysis history, not just the call log. The
 *    assessment keeps provider/model/prompt_version of its own so it stays
 *    self-describing after its run row is gone.
 *
 *  - ai_runs.lead_id is ON DELETE SET NULL for the mirror-image reason: cost
 *    and token history must survive a lead being deleted, or the spend
 *    report quietly shrinks. Eval runs have no lead at all, so the column is
 *    nullable regardless.
 *
 *  - lead_score_rules.department_id is ON DELETE CASCADE, not SET NULL,
 *    because NULL in that column MEANS "applies to every department". SET
 *    NULL would silently widen a department-specific rule to the whole
 *    company the moment someone deleted that department. Dropping the rule
 *    with its department is the safe failure.
 *
 *  - knowledge_entries.search_tsv is a STORED GENERATED column, not a
 *    trigger and not a store-maintained one, so it can never drift from the
 *    text it indexes. to_tsvector's two-argument form with a constant config
 *    is IMMUTABLE, which is what makes it legal in a generated column.
 *    'simple' (not 'english') on purpose: English stemming would mangle both
 *    Gujarati/Hindi enquiry text and product codes. It is deliberately NOT
 *    declared on the Sequelize model — Sequelize would try to INSERT it and
 *    Postgres rejects writes to a generated column; the store reads it
 *    through raw SQL in the FTS fallback path.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---------------------------------------------------------------- 1/5
    // Approved company knowledge, per department. Only `status = 'approved'`
    // rows are ever allowed into a prompt (enforced in the store, not here).
    await queryInterface.createTable('knowledge_entries', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // FK only — no free-text `department` mirror. That duplication exists
      // on `users` for API backwards-compatibility and should not spread to
      // new tables. RESTRICT: knowledge outlives org-chart edits.
      department_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      title: { type: Sequelize.STRING(255), allowNull: false },
      body: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // 'spec' | 'faq' | 'service' | 'pricing_rule' | 'policy' | 'brochure'
      // STRING, not ENUM: adding a kind later should not need a migration.
      kind: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'faq' },
      // 'draft' | 'approved' | 'archived'
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      effective_from: { type: Sequelize.DATEONLY },
      // Past this date the entry is STALE: still sent to the model, but
      // labelled as possibly outdated and surfaced in the admin list.
      // Excluding it would quietly make the AI dumber; flagging it makes
      // somebody fix it.
      review_by: { type: Sequelize.DATEONLY },
      owner_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_at: { type: Sequelize.DATE },
      // Brochure/PDF source; its text is extracted into `body`, which is
      // what actually reaches a prompt.
      attachment_id: { type: Sequelize.UUID, references: { model: 'attachments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Flat { key -> value } used for conflict detection, e.g.
      // { "price.visitiq.base": "45000" }. Two APPROVED entries in the same
      // department giving different values for the same key are flagged.
      // Hand-filled, so an empty object means "nothing to compare" rather
      // than "no conflicts" — the admin UI has to say which.
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // Precomputed on save; drives the token-budget packer that decides
      // full-pack vs FTS fallback.
      token_estimate: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // Staged for a later pgvector rollout. postgresql-17-pgvector exists
      // for PGDG builds but is NOT installed on this server, and installing
      // it is deferred (needs a privileged role + restart on the on-prem
      // box). A JSONB float array backfills painlessly into a real
      // vector(N) column later, but it CANNOT be searched — no ANN index, no
      // distance operator. This is a staging shape, not a search shape.
      embedding_json: { type: Sequelize.JSONB },
      embedding_model: { type: Sequelize.STRING(60) },
      embedding_dim: { type: Sequelize.INTEGER },
      created_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    // The hot path: "every approved entry for this department".
    await queryInterface.addIndex('knowledge_entries', ['department_id', 'status'], { name: 'knowledge_entries_dept_status_idx' });
    // The staleness sweep for the admin list.
    await queryInterface.addIndex('knowledge_entries', ['status', 'review_by'], { name: 'knowledge_entries_status_review_idx' });

    await queryInterface.sequelize.query(
      `ALTER TABLE knowledge_entries
         ADD COLUMN search_tsv tsvector
         GENERATED ALWAYS AS (
           to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
         ) STORED`
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX knowledge_entries_search_tsv_idx ON knowledge_entries USING gin (search_tsv)`
    );

    // ---------------------------------------------------------------- 2/5
    // The channel-agnostic input store. WhatsApp will write HERE later
    // rather than getting a table of its own — that is the whole point of
    // `channel` and of the nullable-unique `external_id`.
    //
    // leads.notes, leads.call_remark and leads.meta_raw_field_data are read
    // as CONTEXT by the analysis assembler and deliberately not copied in:
    // copying would give the same sentence two homes and they would drift
    // the first time someone edited a note.
    await queryInterface.createTable('lead_interactions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      lead_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'leads', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // 'manual_paste' | 'whatsapp' | 'email' | 'call' | 'web_form'
      channel: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'manual_paste' },
      // 'inbound' | 'outbound' | 'internal'
      direction: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'inbound' },
      body: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // Display name of whoever said it — the customer's name for inbound,
      // free text because an inbound author is usually not a MatrixIQ user.
      author: { type: Sequelize.STRING(120) },
      // Set only when the speaker IS a user (an internal note or an
      // outbound reply logged by a rep).
      author_user_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      // The provider's own message id, when there is one. The partial unique
      // index below is what makes a redelivered webhook idempotent — the
      // same guarantee leads.meta_lead_id already gives Meta redelivery.
      external_id: { type: Sequelize.STRING(255) },
      // Detected, for the Hindi/Gujarati eval coverage. '' = not detected.
      language: { type: Sequelize.STRING(10), allowNull: false, defaultValue: '' },
      created_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    // Reading a lead's conversation, newest-first.
    await queryInterface.addIndex('lead_interactions', ['lead_id', 'occurred_at'], { name: 'lead_interactions_lead_occurred_idx' });
    // Raw SQL: addIndex's `where` cannot express IS NOT NULL. Without the
    // IS NOT NULL predicate every row lacking an external_id would collide
    // with every other one on NULL in some engines, and the index would also
    // be mostly dead weight here, since v1's only writer is a human paste.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX lead_interactions_external_id_uq
         ON lead_interactions (external_id)
         WHERE external_id IS NOT NULL AND deleted_at IS NULL`
    );

    // ---------------------------------------------------------------- 3/5
    // One row per provider call, for audit, cost and retention. Created
    // before lead_ai_assessments because that table references it.
    //
    // No deleted_at: the retention purge is a HARD delete. A soft-deleted
    // audit row that still holds the output JSON would defeat the point of
    // having a retention policy at all.
    await queryInterface.createTable('ai_runs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // Nullable: eval runs have no lead. SET NULL on delete so spend
      // history survives the lead being removed.
      lead_id: { type: Sequelize.UUID, references: { model: 'leads', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // 'lead_analysis' | 'eval' | 'feedback_questions'
      purpose: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'lead_analysis' },
      provider: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      model: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
      prompt_version: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      // Provider-REPORTED counts, not the char/4 heuristic. The heuristic is
      // only used pre-flight, to decide what fits in the knowledge budget.
      prompt_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      completion_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      total_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // Computed from ai.pricing in appConfigStore — never a hard-coded rate.
      cost_usd: { type: Sequelize.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
      latency_ms: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // 'ok' | 'timeout' | 'provider_error' | 'schema_invalid' | 'refused' | 'no_key'
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'ok' },
      error_message: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // How many provider calls this run actually cost, including retries,
      // so a degrading provider shows up in the log instead of as
      // unexplained latency.
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // 'full_pack' | 'fts_fallback'. Recorded because the day a
      // department's knowledge base outgrows its token budget, retrieval
      // changes strategy and answer quality shifts — with no record of it,
      // that is invisible.
      retrieval_mode: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'full_pack' },
      knowledge_entry_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      output_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // OFF by default, gated by ai.storeRawPrompts. Holds customer text, so
      // it is the one column here with real privacy weight.
      raw_prompt: { type: Sequelize.TEXT },
      triggered_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      department_id: { type: Sequelize.UUID, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Stamped at INSERT from ai.retentionDays rather than derived from
      // created_at at purge time, so shortening the policy later does not
      // retroactively destroy history somebody was relying on.
      retention_until: { type: Sequelize.DATEONLY, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('ai_runs', ['lead_id', 'created_at'], { name: 'ai_runs_lead_created_idx' });
    // The purge cron's only query.
    await queryInterface.addIndex('ai_runs', ['retention_until'], { name: 'ai_runs_retention_idx' });
    // The admin run log, filtered by outcome.
    await queryInterface.addIndex('ai_runs', ['status', 'created_at'], { name: 'ai_runs_status_created_idx' });
    // Per-department cost rollup.
    await queryInterface.addIndex('ai_runs', ['department_id', 'created_at'], { name: 'ai_runs_dept_created_idx' });

    // ---------------------------------------------------------------- 4/5
    // What the AI concluded about one lead, plus what a human then did about
    // it. History is kept; `is_current` marks the live one.
    await queryInterface.createTable('lead_ai_assessments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      lead_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'leads', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // SET NULL, never CASCADE — see the header note on the retention purge.
      ai_run_id: { type: Sequelize.UUID, references: { model: 'ai_runs', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Whose knowledge base was used to produce this.
      department_id: { type: Sequelize.UUID, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      summary: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // Per field: { value, confidence, source_quote }. source_quote is what
      // makes an extraction checkable instead of merely assertive.
      requirements: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // 'enquiry' | 'price_request' | 'demo_request' | 'support' | 'spam'
      intent: { type: Sequelize.STRING(30), allowNull: false, defaultValue: '' },
      intent_confidence: { type: Sequelize.DECIMAL(4, 3), allowNull: false, defaultValue: 0 },
      suggested_department_id: { type: Sequelize.UUID, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // A ROLE KEY from lib/roleStore.ts (note: Sales is the key `user`),
      // never a named person — routing to an individual is the reporting
      // manager's job, not the model's.
      suggested_owner_role: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
      next_best_action: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // A DRAFT. Nothing in this phase can send it; the panel is copy-only.
      suggested_reply: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // knowledge_entries.id[] actually used. Plain JSONB rather than a join
      // table: it is a point-in-time record of what the model was shown, so
      // it must NOT follow later edits or deletions of those entries.
      citations: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // DEFAULT TRUE, deliberately. A row that failed to populate must read
      // as "a human is needed", never as "cleared". Do not soften this.
      handoff_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      handoff_reason: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // The AI's own band — 'hot' | 'warm' | 'cold' | 'unqualified'. Note
      // 'cold', where leads.priority says 'cool'; the mapping happens on
      // Accept, in one place, rather than by pretending the vocabularies
      // match.
      score_band: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      score_value: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // [{ rule_key, label, points, matched_value, source_quote }] — a score
      // a salesperson cannot interrogate is a score they will ignore.
      score_reasons: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      rules_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // Kept on the assessment as well as the run, so the row stays
      // self-describing after its ai_runs row is purged.
      prompt_version: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      provider: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      model: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
      // Exactly one current assessment per lead — enforced by the partial
      // unique index below, not by store discipline.
      is_current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      accepted_at: { type: Sequelize.DATE },
      accepted_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Which field names the human actually took, so partial acceptance is
      // distinguishable from wholesale acceptance in the eval feedback.
      accepted_fields: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // '' | 'used' | 'rejected' — the reply-quality feedback signal.
      reply_outcome: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      reply_outcome_at: { type: Sequelize.DATE },
      reply_outcome_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Manual band override. There is no separate lead_score_overrides
      // table on purpose: the effective value lives on leads.priority, the
      // latest verdict here, and the history in audit_logs via logAudit. A
      // fourth copy would be the first one to go stale.
      override_band: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      // Full text. audit_logs.remarks is truncated to 255 by fit() in
      // lib/auditLogStore.ts, so the untruncated reason has to live here.
      override_reason: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      override_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      override_at: { type: Sequelize.DATE },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    // History for one lead, newest-first.
    await queryInterface.addIndex('lead_ai_assessments', ['lead_id', 'created_at'], { name: 'lead_ai_assessments_lead_created_idx' });
    // Raw SQL: a boolean predicate, which addIndex's `where` cannot express.
    // This is also the in-flight guard's backing constraint — see the store.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX lead_ai_assessments_current_uq
         ON lead_ai_assessments (lead_id)
         WHERE is_current AND deleted_at IS NULL`
    );

    // ---------------------------------------------------------------- 5/5
    // The explainable scoring table: signal -> operator -> weight. AI
    // extractions feed these rules; the model never sets the band itself.
    //
    // Band THRESHOLDS are not here — they live in appConfigStore, because
    // three numbers are configuration, not rows, and keeping them out stops
    // somebody editing a threshold as though it were a rule.
    await queryInterface.createTable('lead_score_rules', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      key: { type: Sequelize.STRING(60), allowNull: false },
      // What the breakdown shows the user, e.g. "Budget stated".
      label: { type: Sequelize.STRING(160), allowNull: false, defaultValue: '' },
      // Which extracted field or lead condition this reads, e.g.
      // 'requirements.budget', 'intent', 'lead.contact'.
      //
      // NOTE: there is deliberately no volume signal. Message count must
      // never raise a score — somebody sending five messages because they
      // are confused is not a hotter lead than somebody who stated a budget
      // once. See tests/unit/leadScoring.test.ts.
      signal: { type: Sequelize.STRING(60), allowNull: false },
      // 'present' | 'absent' | 'gte' | 'lte' | 'equals' | 'in' | 'matches'
      operator: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'present' },
      comparand: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // May be negative (spam, no contact method).
      weight: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // An AI-extracted field below this confidence contributes nothing, so
      // a guess cannot quietly become a score.
      min_confidence: { type: Sequelize.DECIMAL(4, 3), allowNull: false, defaultValue: 0.6 },
      // NULL means "every department" — which is why this FK CASCADEs
      // instead of SET NULL. See the header note.
      department_id: { type: Sequelize.UUID, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'active' },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      updated_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('lead_score_rules', ['key'], {
      name: 'lead_score_rules_key_uq',
      unique: true,
      where: { deleted_at: null }
    });
    await queryInterface.addIndex('lead_score_rules', ['status', 'order'], { name: 'lead_score_rules_status_order_idx' });
  },

  async down(queryInterface) {
    // Reverse creation order, children first. Raw indexes are dropped with
    // their tables; the explicit DROP INDEX calls are belt-and-braces for a
    // partially-applied up().
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS lead_ai_assessments_current_uq');
    await queryInterface.dropTable('lead_score_rules');
    await queryInterface.dropTable('lead_ai_assessments');
    await queryInterface.dropTable('ai_runs');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS lead_interactions_external_id_uq');
    await queryInterface.dropTable('lead_interactions');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS knowledge_entries_search_tsv_idx');
    await queryInterface.dropTable('knowledge_entries');
  }
};
