-- =====================================================================
-- Migration: Add custom_roles, system_role_overrides, user_page_access
--            and can_view_passwords — required for Role Management,
--            User Page Control, and password-visibility features.
--
-- Run this ONCE on any existing database to enable:
--   1. Role Management page (/admin/roles)
--   2. User Page Control (/admin/user-page-control)
--   3. Per-user password visibility toggle
--   4. Page Access page loading without 500 errors
-- =====================================================================

-- 1. Drop old strict role CHECK on users so custom role names can be stored.
--    Role validation is enforced at the application layer.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(64);

-- 2. Add can_view_passwords column to users (default FALSE = no access).
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_passwords BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Create custom_roles table.
CREATE TABLE IF NOT EXISTS custom_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(64) UNIQUE NOT NULL,
    label       VARCHAR(128) NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_roles_name ON custom_roles(name);

-- 4. Create system_role_overrides table (allows renaming built-in roles).
CREATE TABLE IF NOT EXISTS system_role_overrides (
    name        VARCHAR(64) PRIMARY KEY,
    label       VARCHAR(128) NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Create user_page_access table (per-user page access overrides).
CREATE TABLE IF NOT EXISTS user_page_access (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_key    VARCHAR(128) NOT NULL,
    allowed     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, page_key)
);
CREATE INDEX IF NOT EXISTS idx_user_page_access_user ON user_page_access(user_id);

-- 6. Widen page_access.role column to match (VARCHAR(32) → VARCHAR(64))
--    so custom role names (up to 64 chars) fit.
ALTER TABLE page_access ALTER COLUMN role TYPE VARCHAR(64);
