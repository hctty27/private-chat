BEGIN;

ALTER TABLE t_message
    ADD COLUMN IF NOT EXISTS client_msg_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uk_message_sender_client_msg_id
    ON t_message (sender_id, client_msg_id)
    WHERE client_msg_id IS NOT NULL;

COMMIT;
