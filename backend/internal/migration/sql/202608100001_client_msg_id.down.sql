BEGIN;

DROP INDEX IF EXISTS uk_message_sender_client_msg_id;

ALTER TABLE t_message
    DROP COLUMN IF EXISTS client_msg_id;

COMMIT;
