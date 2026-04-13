package com.privatechat.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.privatechat.dto.ContactDTO;
import com.privatechat.entity.Message;
import com.privatechat.entity.Relation;
import com.privatechat.entity.User;
import com.privatechat.mapper.MessageMapper;
import com.privatechat.mapper.RelationMapper;
import com.privatechat.mapper.UserMapper;
import com.privatechat.service.ContactService;
import com.privatechat.util.ConversationUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ContactServiceImpl implements ContactService {

    private final RelationMapper relationMapper;
    private final UserMapper userMapper;
    private final MessageMapper messageMapper;
    private final StringRedisTemplate redisTemplate;

    @Override
    public List<ContactDTO> getContacts(Long userId) {
        List<Relation> relations = relationMapper.selectList(
                new LambdaQueryWrapper<Relation>().eq(Relation::getUserId, userId)
        );

        List<ContactDTO> contacts = new ArrayList<>();
        DateTimeFormatter formatter = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

        for (Relation relation : relations) {
            Long targetId = relation.getTargetId();
            User targetUser = userMapper.selectById(targetId);
            if (targetUser == null) continue;

            String conversationId = ConversationUtil.generateConversationId(userId, targetId);

            // Check online status
            Boolean online = redisTemplate.hasKey("online:" + targetId);

            // Get last message
            Message lastMessage = messageMapper.selectOne(
                    new LambdaQueryWrapper<Message>()
                            .eq(Message::getConversationId, conversationId)
                            .orderByDesc(Message::getCreatedAt)
                            .last("LIMIT 1")
            );

            String lastMessageContent = lastMessage != null ? lastMessage.getContent() : null;
            String lastMessageTime = lastMessage != null ? lastMessage.getCreatedAt().format(formatter) : null;

            // Count unread messages
            Integer unreadCount = Math.toIntExact(messageMapper.selectCount(
                    new LambdaQueryWrapper<Message>()
                            .eq(Message::getConversationId, conversationId)
                            .eq(Message::getSenderId, targetId)
                            .eq(Message::getReceiverId, userId)
                            .eq(Message::getIsRead, 0)
            ));

            contacts.add(new ContactDTO(
                    targetId,
                    targetUser.getNickname(),
                    online != null && online,
                    lastMessageContent,
                    lastMessageTime,
                    unreadCount
            ));
        }

        return contacts;
    }
}
