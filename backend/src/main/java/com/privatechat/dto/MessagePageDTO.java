package com.privatechat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class MessagePageDTO {
    private List<MessageDTO> messages;
    private Boolean hasMore;
}
