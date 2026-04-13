package com.privatechat.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.privatechat.dto.MessageDTO;
import com.privatechat.entity.Message;
import com.privatechat.mapper.MessageMapper;
import com.privatechat.service.MessageService;
import com.privatechat.util.ConversationUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final MessageService messageService;
    private final MessageMapper messageMapper;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    // userId -> WebSocketSession
    private static final Map<Long, WebSocketSession> SESSION_MAP = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Long userId = (Long) session.getAttributes().get("userId");
        if (userId != null) {
            SESSION_MAP.put(userId, session);
            redisTemplate.opsForValue().set("online:" + userId, "1", Duration.ofMinutes(2));
            broadcastOnlineStatus(userId, true);
            log.info("User {} connected", userId);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long userId = (Long) session.getAttributes().get("userId");
        if (userId != null) {
            SESSION_MAP.remove(userId);
            redisTemplate.delete("online:" + userId);
            broadcastOnlineStatus(userId, false);
            log.info("User {} disconnected", userId);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Long userId = (Long) session.getAttributes().get("userId");
        if (userId == null) return;

        JsonNode jsonNode = objectMapper.readTree(message.getPayload());
        String type = jsonNode.get("type").asText();
        JsonNode data = jsonNode.get("data");

        switch (type) {
            case "chat" -> handleChat(userId, data);
            case "heartbeat" -> handleHeartbeat(userId, session);
            case "read" -> handleRead(userId, data);
            default -> sendError(session, "Unknown message type: " + type);
        }
    }

    private void handleChat(Long senderId, JsonNode data) throws IOException {
        Long receiverId = data.get("receiverId").asLong();
        Integer msgType = data.get("msgType").asInt();
        String content = data.path("content").asText(null);
        String fileUrl = data.path("fileUrl").asText(null);
        String fileName = data.path("fileName").asText(null);
        Long fileSize = data.has("fileSize") && !data.get("fileSize").isNull() ? data.get("fileSize").asLong() : null;

        MessageDTO savedMessage = messageService.saveMessage(senderId, receiverId, msgType, content, fileUrl, fileName, fileSize);

        // Send to sender
        WebSocketSession senderSession = SESSION_MAP.get(senderId);
        if (senderSession != null && senderSession.isOpen()) {
            sendMessage(senderSession, "chat", savedMessage);
        }

        // Send to receiver if online
        WebSocketSession receiverSession = SESSION_MAP.get(receiverId);
        if (receiverSession != null && receiverSession.isOpen()) {
            sendMessage(receiverSession, "chat", savedMessage);
        }
    }

    private void handleHeartbeat(Long userId, WebSocketSession session) throws IOException {
        redisTemplate.expire("online:" + userId, Duration.ofMinutes(2));
        sendMessage(session, "heartbeat_ack", Map.of());
    }

    private void handleRead(Long userId, JsonNode data) throws IOException {
        Long targetId = data.get("targetId").asLong();
        messageService.markAsRead(userId, targetId);

        String conversationId = ConversationUtil.generateConversationId(userId, targetId);

        // Notify target user
        WebSocketSession targetSession = SESSION_MAP.get(targetId);
        if (targetSession != null && targetSession.isOpen()) {
            sendMessage(targetSession, "read", Map.of(
                    "readerId", userId,
                    "conversationId", conversationId
            ));
        }
    }

    private void broadcastOnlineStatus(Long userId, boolean online) {
        Map<String, Object> statusData = Map.of(
                "userId", userId,
                "online", online
        );

        SESSION_MAP.forEach((uid, session) -> {
            if (!uid.equals(userId) && session.isOpen()) {
                try {
                    sendMessage(session, "online", statusData);
                } catch (IOException e) {
                    log.error("Failed to broadcast online status", e);
                }
            }
        });
    }

    private void sendMessage(WebSocketSession session, String type, Object data) throws IOException {
        Map<String, Object> message = Map.of(
                "type", type,
                "data", data
        );
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
    }

    private void sendError(WebSocketSession session, String errorMessage) throws IOException {
        sendMessage(session, "error", Map.of("message", errorMessage));
    }
}
