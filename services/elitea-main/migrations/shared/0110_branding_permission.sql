-- 0110_branding_permission.sql — the ADMINISTRATION-mode grant behind the
-- admin Branding surface (ADR-0024, decision 5).
--
--   configuration.branding  ← GET/PUT /admin/branding/administration
--                             the `branding` section on the Configuration page
--
-- CHOSEN, NOT RECOVERED. White-labeling is net-new to the product: the legacy
-- platform ships one hard-coded brand and its permission catalogue has no
-- string for it, so there is nothing to transcribe.
--
-- WHO HOLDS IT. `super_admin` and `admin` in the `administration` mode, the
-- same holder set as every other central configuration grant (0060, 0061,
-- 0082). A rebrand changes what every user sees on every page, which is a
-- platform-wide act; giving it to an editor would be wider than the banner
-- switch it sits beside.
--
-- WHY A NEW FILE. 0060 returns early when any administration-mode role exists,
-- so an edit there would seed fresh databases only and leave every running
-- deployment at 403; migrations are also checksum-immutable. The
-- to_regclass guard and ON CONFLICT DO NOTHING make this file inert on a
-- database that has no roles yet and on a repeat run.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0110: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('configuration.branding')
) AS grant_row(permission)
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
