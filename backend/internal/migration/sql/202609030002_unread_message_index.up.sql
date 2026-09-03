CREATE INDEX IF NOT EXISTS idx_message_unread_receiver_conversation
    ON t_message (receiver_id, conversation_id)
    WHERE is_read = 0;
