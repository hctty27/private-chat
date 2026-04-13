package com.privatechat.controller;

import com.privatechat.dto.ContactDTO;
import com.privatechat.dto.Result;
import com.privatechat.service.ContactService;
import com.privatechat.util.JwtUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/contacts")
@RequiredArgsConstructor
public class ContactController {

    private final ContactService contactService;
    private final JwtUtil jwtUtil;

    @GetMapping
    public Result<List<ContactDTO>> getContacts(HttpServletRequest request) {
        Long userId = getUserIdFromRequest(request);
        return Result.success(contactService.getContacts(userId));
    }

    private Long getUserIdFromRequest(HttpServletRequest request) {
        String token = request.getHeader("Authorization");
        if (token != null && token.startsWith("Bearer ")) {
            token = token.substring(7);
        }
        return jwtUtil.getUserIdFromToken(token);
    }
}
