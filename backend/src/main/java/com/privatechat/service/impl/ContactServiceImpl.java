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
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ContactServiceImpl implements ContactService {

    private final RelationMapper relationMapper;
    private final UserMapper userMapper;
    private final MessageMapper messageMapper;
    private final StringRedisTemplate redisTemplate;

    @Override
    public List<ContactDTO> getContacts(Long userId) {
        // 1. Get all relations
        List<Relation> relations = relationMapper.selectList(
                new LambdaQueryWrapper<Relation>().eq(Relation::getUserId, userId)
        );
        if (relations.isEmpty()) return Collections.emptyList();

        List<Long> targetIds = relations.stream().map(Relation::getTargetId).collect(Collectors.toList());

        // 2. Batch query all target users (1 query)
        List<User> users = userMapper.selectBatchIds(targetIds);
        Map<Long, User> userMap = users.stream().collect(Collectors.toMap(User::getId, u -> u));

        // 3. Generate all conversation IDs
        Map<Long, String> convMap = new HashMap<>();
        for (Long targetId : targetIds) {
            convMap.put(targetId, ConversationUtil.generateConversationId(userId, targetId));
        }

        // 4. Check online status for all (1 Redis call per user, but Redis is fast)
        Map<Long, Boolean> onlineMap = new HashMap<>();
        for (Long targetId : targetIds) {
            Boolean online = redisTemplate.hasKey("online:" + targetId);
            onlineMap.put(targetId, online != null && online);
        }

        // 5. Get last messages for all conversations (1 query with IN)
        List<String> convIds = new ArrayList<>(convMap.values());
        Map<String, Message> lastMsgMap = getLastMessages(convIds);

        // 6. Get unread counts for all conversations (1 query with GROUP BY)
        Map<String, Integer> unreadMap = getUnreadCounts(convIds, userId);

        // 7. Assemble result
        List<ContactDTO> contacts = new ArrayList<>();
        DateTimeFormatter formatter = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

        for (Relation relation : relations) {
            Long targetId = relation.getTargetId();
            User user = userMap.get(targetId);
            if (user == null) continue;

            String convId = convMap.get(targetId);
            Message lastMsg = lastMsgMap.get(convId);
            Integer unreadCount = unreadMap.getOrDefault(convId, 0);

            contacts.add(new ContactDTO(
                    targetId,
                    user.getNickname(),
                    onlineMap.getOrDefault(targetId, false),
                    lastMsg != null ? getContentPreview(lastMsg) : null,
                    lastMsg != null ? lastMsg.getCreatedAt().format(formatter) : null,
                    unreadCount
            ));
        }

        return contacts;
    }

    private Map<String, Message> getLastMessages(List<String> convIds) {
        if (convIds.isEmpty()) return Collections.emptyMap();
        // Get all messages for these conversations, sorted by created_at desc
        // Then keep only the latest per conversation
        List<Message> messages = messageMapper.selectList(
                new LambdaQueryWrapper<Message>()
                        .in(Message::getConversationId, convIds)
                        .orderByDesc(Message::getCreatedAt)
        );

        Map<String, Message> result = new LinkedHashMap<>();
        for (Message msg : messages) {
            result.putIfAbsent(msg.getConversationId(), msg);
        }
        return result;
    }

    private Map<String, Integer> getUnreadCounts(List<String> convIds, Long userId) {
        if (convIds.isEmpty()) return Collections.emptyMap();
        // Raw SQL for GROUP BY
        List<Message> unreadMessages = messageMapper.selectList(
                new LambdaQueryWrapper<Message>()
                        .select(Message::getConversationId)
                        .in(Message::getConversationId, convIds)
                        .eq(Message::getReceiverId, userId)
                        .eq(Message::getIsRead, 0)
        );

        Map<String, Integer> result = new HashMap<>();
        for (Message msg : unreadMessages) {
            result.merge(msg.getConversationId(), 1, Integer::sum);
        }
        return result;
    }

    private String getContentPreview(Message msg) {
        return switch (msg.getMsgType()) {
            case 1 -> msg.getContent();
            case 2 -> "[图片]";
            case 3 -> "[文件] " + msg.getFileName();
            case 4 -> msg.getContent();
            default -> "[消息]";
        };
    }
}
