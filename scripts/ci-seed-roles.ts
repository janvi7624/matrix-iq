// CI-only: a freshly-migrated database has an empty roles table (migrations
// create schema, not seed data). The app normally seeds built-in roles
// lazily on first access via lib/roleStore.ts's listRoles(), but nothing in
// this workflow triggers that before Playwright's fixtures try to look up
// roles by key directly — so every fixture-creating E2E test failed with
// "No role with key ... exists". Calling listRoles() once here seeds them.
import { listRoles } from '../lib/roleStore';

listRoles()
  .then((roles) => {
    console.log(`Seeded/verified ${roles.length} roles.`);
  })
  .catch((err) => {
    console.error('Role seed failed:', err);
    process.exit(1);
  });
