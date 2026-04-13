-- 私聊系统数据库初始化脚本

CREATE DATABASE IF NOT EXISTS private_chat DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE private_chat;

-- 用户表
CREATE TABLE IF NOT EXISTS t_user (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(50) NOT NULL UNIQUE,
    password    VARCHAR(128) NOT NULL,
    nickname    VARCHAR(50) NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 关系表
CREATE TABLE IF NOT EXISTS t_relation (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT NOT NULL,
    target_id   BIGINT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_relation (user_id, target_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 消息表
CREATE TABLE IF NOT EXISTS t_message (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id VARCHAR(64) NOT NULL,
    sender_id       BIGINT NOT NULL,
    receiver_id     BIGINT NOT NULL,
    msg_type        TINYINT NOT NULL COMMENT '1:文本 2:图片 3:文件 4:emoji',
    content         TEXT,
    file_url        VARCHAR(512),
    file_name       VARCHAR(255),
    file_size       BIGINT,
    is_read         TINYINT DEFAULT 0 COMMENT '0:未读 1:已读',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_conversation (conversation_id, created_at),
    INDEX idx_receiver_unread (receiver_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 测试用户（密码都是 123456 的 BCrypt 加密）
-- BCrypt("123456") = $2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi
INSERT INTO t_user (username, password, nickname) VALUES
('alice', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', '爱丽丝'),
('bob', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', '鲍勃'),
('charlie', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', '查理');

-- 测试关系（双向）
INSERT INTO t_relation (user_id, target_id) VALUES
(1, 2), (2, 1),   -- alice <-> bob
(1, 3), (3, 1),   -- alice <-> charlie
(2, 3), (3, 2);   -- bob <-> charlie
