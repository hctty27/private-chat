package com.privatechat.service;

import com.privatechat.dto.FileUploadDTO;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;

public interface FileService {
    FileUploadDTO upload(MultipartFile file);
    InputStream download(String objectName);
    String getContentType(String objectName);
}
