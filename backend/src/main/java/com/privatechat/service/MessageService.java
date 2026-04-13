package com.privatechat.service;

import com.privatechat.dto.MessageDTO;
import com.privatechat.dto.MessagePageDTO;

public interface MessageService {
    MessageDTO saveMessage(Long senderId, Long receiverId, Integer msgType, String content, String fileUrl, String fileName, Long fileSize);
    MessagePageDTO getMessages(Long userId, Long targetId, Long cursor, Integer size, String mode);
    void markAsRead(Long userId, Long targetId);
}
