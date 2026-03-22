-- Optional: keep this seed minimal; the Netlify API bootstrap seeds lots/users/buildings/walk maps automatically.
-- Mark bootstrap as stale so first runtime boot refreshes heavy derived tables.
INSERT INTO system_meta (key, value)
VALUES ('bootstrap_version', 'pending')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
