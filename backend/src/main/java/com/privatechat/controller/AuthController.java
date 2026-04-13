package com.privatechat.controller;

import com.privatechat.dto.LoginRequest;
import com.privatechat.dto.Result;
import com.privatechat.dto.LoginResponse;
import com.privatechat.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public Result<LoginResponse> login(@RequestBody LoginRequest request) {
        return Result.success(authService.login(request));
    }
}
