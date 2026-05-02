-- Verify openf1:001_create_schemas on pg

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'raw') THEN
    RAISE EXCEPTION '001_create_schemas: schema raw missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core') THEN
    RAISE EXCEPTION '001_create_schemas: schema core missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION '001_create_schemas: extension pgcrypto missing';
  END IF;
END $$;

ROLLBACK;
