'use strict';

// "new row violates row-level security policy for table
// 'project_technical_requests'" when a salesperson picked a technical person.
//
// The Supabase database has row-level security ON for the app's tables, and the
// app connects as the low-privilege role `matrixiq_vps` (no BYPASSRLS). Every
// table carries the same permissive policy for that role —
//     CREATE POLICY vps_all ... FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true)
// — except project_technical_requests, which had RLS switched on later without
// that policy. With RLS on and no policy, Postgres denies everything: the INSERT
// that raises a technical-person request fails, and reads silently return no rows.
// (The table owner, matrixiq_owner, bypasses RLS, which is why it works with the
// owner's connection string and only breaks on the app's own role.)
//
// This adds the missing policy, and — because a new table getting RLS turned on
// without one is exactly how this happened — gives the same policy to any other
// table in `public` that lacks it. On a table with RLS off the policy is inert,
// so this changes nothing there until someone enables RLS on it, at which point
// the app keeps working instead of failing the way this one did. Idempotent, and
// a no-op on a database that has no matrixiq_vps role (e.g. a local one).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE t record;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrixiq_vps') THEN
          RETURN;
        END IF;
        FOR t IN
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'vps_all'
            )
        LOOP
          EXECUTE format(
            'CREATE POLICY vps_all ON public.%I FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true)',
            t.relname
          );
        END LOOP;
      END $$;
    `);
  },

  // Only the tables that were missing the policy when this ran.
  async down(queryInterface) {
    for (const table of ['project_technical_requests', 'file_objects', 'payment_holds', 'project_deadline_extensions']) {
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS vps_all ON public.${table}`);
    }
  }
};
