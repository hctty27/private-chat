DROP INDEX IF EXISTS idx_message_reply_to;

ALTER TABLE t_message
    DROP CONSTRAINT IF EXISTS fk_message_reply_to;

ALTER TABLE t_message
    DROP COLUMN IF EXISTS reply_to_message_id;
