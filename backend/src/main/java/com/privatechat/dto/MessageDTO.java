package com.privatechat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class MessageDTO {
    private Long id;
    private String conversationId;
    private Long senderId;
    private Long receiverId;
    private Integer msgType;
    private String content;
    private String fileUrl;
    private String fileName;
    private Long fileSize;
    private Integer isRead;
    private String createdAt;
}
