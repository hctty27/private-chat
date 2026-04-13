package com.privatechat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FileUploadDTO {
    private String url;
    private String fileName;
    private Long fileSize;
}
