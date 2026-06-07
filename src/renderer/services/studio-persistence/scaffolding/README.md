# Studio Persistence Scaffolding

This folder contains temporary helpers used while migrating legacy renderer
storage into project `studio/` resource files.

These files are intentionally not exported from `../index.ts`. Delete this
folder once the legacy migration path and its equivalence tests are retired.

- `legacy-migration.ts` maps legacy renderer storage keys into Studio resource
  models.
- `migration-equivalence.ts` supports tests that compare legacy and resource
  file loads while the migration path exists.
