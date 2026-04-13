package com.privatechat.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_message")
public class Message {
    @TableId(type = IdType.AUTO)
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
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
