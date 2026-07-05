-- Allow duplicate VM names across all inventory tables.
-- Only IP address uniqueness is enforced.

-- Drop inline UNIQUE constraints (auto-named by PostgreSQL at table creation)
ALTER TABLE assets                DROP CONSTRAINT IF EXISTS assets_vm_name_key;
ALTER TABLE beijing_assets        DROP CONSTRAINT IF EXISTS beijing_assets_vm_name_key;
ALTER TABLE ext_assets            DROP CONSTRAINT IF EXISTS ext_assets_vm_name_key;
ALTER TABLE physical_esxi_servers DROP CONSTRAINT IF EXISTS physical_esxi_servers_vm_name_key;

-- Drop conditional partial unique indexes on vm_name
DROP INDEX IF EXISTS uq_assets_vm_active;
DROP INDEX IF EXISTS uq_beijing_vm_active;
DROP INDEX IF EXISTS uq_ext_vm_active;
DROP INDEX IF EXISTS uq_physical_vm_active;
