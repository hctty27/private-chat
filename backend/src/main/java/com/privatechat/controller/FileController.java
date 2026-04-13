package com.privatechat.controller;

import com.privatechat.dto.FileUploadDTO;
import com.privatechat.dto.Result;
import com.privatechat.service.FileService;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.io.OutputStream;

@RestController
@RequestMapping("/api/file")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @PostMapping("/upload")
    public Result<FileUploadDTO> upload(@RequestParam("file") MultipartFile file) {
        return Result.success(fileService.upload(file));
    }

    @GetMapping("/download/{objectName}")
    public void download(@PathVariable String objectName, HttpServletResponse response) {
        try {
            String contentType = fileService.getContentType(objectName);
            response.setContentType(contentType);
            response.setHeader("Content-Disposition", "inline; filename=\"" + objectName + "\"");

            try (InputStream in = fileService.download(objectName);
                 OutputStream out = response.getOutputStream()) {
                byte[] buffer = new byte[4096];
                int bytesRead;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                }
            }
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        }
    }
}
