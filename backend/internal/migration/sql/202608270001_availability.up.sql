ALTER TABLE t_user
    ADD COLUMN IF NOT EXISTS availability_start_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS availability_end_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS availability_note VARCHAR(80);

ALTER TABLE t_user
    DROP CONSTRAINT IF EXISTS ck_user_availability_window;

ALTER TABLE t_user
    ADD CONSTRAINT ck_user_availability_window CHECK (
        (availability_start_at IS NULL AND availability_end_at IS NULL)
        OR (
            availability_start_at IS NOT NULL
            AND availability_end_at IS NOT NULL
            AND availability_end_at > availability_start_at
        )
    );
