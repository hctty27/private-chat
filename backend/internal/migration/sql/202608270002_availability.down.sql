ALTER TABLE t_user
    DROP CONSTRAINT IF EXISTS ck_user_availability_window,
    DROP COLUMN IF EXISTS availability_note,
    DROP COLUMN IF EXISTS availability_end_at,
    DROP COLUMN IF EXISTS availability_start_at;
