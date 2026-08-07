DO $$
DECLARE
    file_rows INTEGER;
    linked_rows INTEGER;
    distinct_links INTEGER;
BEGIN
    SELECT COUNT(*) INTO file_rows
    FROM t_file
    WHERE object_key = 'shared.jpg';
    IF file_rows <> 2 THEN
        RAISE EXCEPTION 'expected 2 conversation-scoped shared.jpg rows, got %', file_rows;
    END IF;

    SELECT COUNT(*) INTO linked_rows
    FROM t_message
    WHERE id IN (1, 2) AND file_id IS NOT NULL;
    IF linked_rows <> 2 THEN
        RAISE EXCEPTION 'expected both legacy messages to receive file_id, got %', linked_rows;
    END IF;

    SELECT COUNT(DISTINCT file_id) INTO distinct_links
    FROM t_message
    WHERE id IN (1, 2);
    IF distinct_links <> 2 THEN
        RAISE EXCEPTION 'expected separate file records per conversation, got %', distinct_links;
    END IF;

    IF EXISTS (SELECT 1 FROM t_message WHERE id = 3 AND file_id IS NOT NULL) THEN
        RAISE EXCEPTION 'text message must not receive file_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 't_message' AND column_name = 'file_url'
    ) THEN
        RAISE EXCEPTION 'legacy file_url column must remain during compatibility window';
    END IF;
END $$;
