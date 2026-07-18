-- Seed frank@example.com as admin for OIDC testing.
-- Run: podman exec -i deploy-postgres-1 psql -U eliteausr -d eliteadmstage2 < deploy/scripts/seed-staging-oidc-user.sql

INSERT INTO auth_core__user (email, name)
VALUES ('frank@example.com', 'Frank')
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_core__user_role (user_id, role_id)
SELECT u.id, r.id
FROM auth_core__user u
JOIN auth_core__role r ON r.name = 'admin'
WHERE u.email = 'frank@example.com'
  AND r.mode IN ('default', 'administration')
ON CONFLICT (user_id, role_id) DO NOTHING;
