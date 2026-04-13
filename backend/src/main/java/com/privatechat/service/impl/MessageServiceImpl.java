package com.privatechat.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.privatechat.dto.MessageDTO;
import com.privatechat.dto.MessagePageDTO;
import com.privatechat.entity.Message;
import com.privatechat.mapper.MessageMapper;
import com.privatechat.service.MessageService;
import com.privatechat.util.ConversationUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MessageServiceImpl implements MessageService {

    private final MessageMapper messageMapper;

    @Value("${app.message.page-size}")
    private Integer defaultPageSize;

    @Override
    public MessageDTO saveMessage(Long senderId, Long receiverId, Integer msgType, String content, String fileUrl, String fileName, Long fileSize) {
        String conversationId = ConversationUtil.generateConversationId(senderId, receiverId);

        Message message = new Message();
        message.setConversationId(conversationId);
        message.setSenderId(senderId);
        message.setReceiverId(receiverId);
        message.setMsgType(msgType);
        message.setContent(content);
        message.setFileUrl(fileUrl);
        message.setFileName(fileName);
        message.setFileSize(fileSize);
        message.setIsRead(0);

        messageMapper.insert(message);
        return convertToDTO(message);
    }

    @Override
    public MessagePageDTO getMessages(Long userId, Long targetId, Long cursor, Integer size, String mode) {
        String conversationId = ConversationUtil.generateConversationId(userId, targetId);
        int pageSize = size != null ? size : defaultPageSize;

        List<Message> messages;

        if ("loadMore".equals(mode) && cursor != null) {
            // Load messages before cursor timestamp
            messages = messageMapper.selectList(
                    new LambdaQueryWrapper<Message>()
                            .eq(Message::getConversationId, conversationId)
                            .lt(Message::getCreatedAt, LocalDateTime.ofEpochSecond(cursor / 1000, 0, java.time.ZoneOffset.UTC))
                            .orderByDesc(Message::getCreatedAt)
                            .last("LIMIT " + (pageSize + 1))
            );
        } else {
            // Init mode: return last N messages + all unread messages
            List<Message> lastMessages = messageMapper.selectList(
                    new LambdaQueryWrapper<Message>()
                            .eq(Message::getConversationId, conversationId)
                            .orderByDesc(Message::getCreatedAt)
                            .last("LIMIT " + pageSize)
            );

            List<Message> unreadMessages = messageMapper.selectList(
                    new LambdaQueryWrapper<Message>()
                            .eq(Message::getConversationId, conversationId)
                            .eq(Message::getReceiverId, userId)
                            .eq(Message::getIsRead, 0)
                            .orderByAsc(Message::getCreatedAt)
            );

            // Merge and dedupe
            Set<Long> lastIds = lastMessages.stream().map(Message::getId).collect(Collectors.toSet());
            messages = new ArrayList<>(lastMessages);
            for (Message msg : unreadMessages) {
                if (!lastIds.contains(msg.getId())) {
                    messages.add(msg);
                }
            }

            // Sort by created_at ascending
            messages.sort(Comparator.comparing(Message::getCreatedAt));
        }

        boolean hasMore = messages.size() > pageSize;
        if (hasMore) {
            messages = messages.subList(0, pageSize);
        }

        List<MessageDTO> messageDTOs = messages.stream().map(this::convertToDTO).collect(Collectors.toList());
        return new MessagePageDTO(messageDTOs, hasMore);
    }

    @Override
    public void markAsRead(Long userId, Long targetId) {
        String conversationId = ConversationUtil.generateConversationId(userId, targetId);

        messageMapper.update(null,
                new LambdaUpdateWrapper<Message>()
                        .eq(Message::getConversationId, conversationId)
                        .eq(Message::getReceiverId, userId)
                        .eq(Message::getSenderId, targetId)
                        .eq(Message::getIsRead, 0)
                        .set(Message::getIsRead, 1)
        );
    }

    private MessageDTO convertToDTO(Message message) {
        DateTimeFormatter formatter = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
        return new MessageDTO(
                message.getId(),
                message.getConversationId(),
                message.getSenderId(),
                message.getReceiverId(),
                message.getMsgType(),
                message.getContent(),
                message.getFileUrl(),
                message.getFileName(),
                message.getFileSize(),
                message.getIsRead(),
                message.getCreatedAt() != null ? message.getCreatedAt().format(formatter) : null
        );
    }
}
