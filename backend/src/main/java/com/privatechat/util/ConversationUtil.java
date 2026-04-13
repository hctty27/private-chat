package com.privatechat.util;

public class ConversationUtil {

    public static String generateConversationId(Long userId1, Long userId2) {
        if (userId1 < userId2) {
            return userId1 + "_" + userId2;
        }
        return userId2 + "_" + userId1;
    }
}
