package com.privatechat.controller;

import com.privatechat.dto.MessagePageDTO;
import com.privatechat.dto.Result;
import com.privatechat.service.MessageService;
import com.privatechat.util.JwtUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/messages")
@RequiredArgsConstructor
public class MessageController {

    private final MessageService messageService;
    private final JwtUtil jwtUtil;

    @GetMapping("/{targetId}")
    public Result<MessagePageDTO> getMessages(
            @PathVariable Long targetId,
            @RequestParam(required = false) Long cursor,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false, defaultValue = "init") String mode,
            HttpServletRequest request
    ) {
        Long userId = getUserIdFromRequest(request);
        return Result.success(messageService.getMessages(userId, targetId, cursor, size, mode));
    }

    private Long getUserIdFromRequest(HttpServletRequest request) {
        String token = request.getHeader("Authorization");
        if (token != null && token.startsWith("Bearer ")) {
            token = token.substring(7);
        }
        return jwtUtil.getUserIdFromToken(token);
    }
}
