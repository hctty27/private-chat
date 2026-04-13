package com.privatechat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ContactDTO {
    private Long userId;
    private String nickname;
    private Boolean online;
    private String lastMessage;
    private String lastMessageTime;
    private Integer unreadCount;
}
