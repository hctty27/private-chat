DO $$
BEGIN
    IF to_regclass('public.t_file') IS NOT NULL THEN
        RAISE EXCEPTION 't_file should be removed by rollback';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 't_message' AND column_name = 'file_id'
    ) THEN
        RAISE EXCEPTION 't_message.file_id should be removed by rollback';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 't_message' AND column_name = 'file_url'
    ) THEN
        RAISE EXCEPTION 'legacy file_url column must remain after rollback';
    END IF;
END $$;
