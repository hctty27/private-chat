CREATE INDEX IF NOT EXISTS idx_message_conversation_cursor
    ON t_message (conversation_id, created_at DESC, id DESC);
