ALTER TABLE t_message
    ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 't_message'::regclass
          AND a.attname = 'reply_to_message_id'
    ) THEN
        ALTER TABLE t_message
            ADD CONSTRAINT fk_message_reply_to
            FOREIGN KEY (reply_to_message_id)
            REFERENCES t_message(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_message_reply_to
    ON t_message (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;
