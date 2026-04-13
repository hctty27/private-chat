package com.privatechat.service;

import com.privatechat.dto.LoginRequest;
import com.privatechat.dto.LoginResponse;

public interface AuthService {
    LoginResponse login(LoginRequest request);
    boolean validateUserToken(Long userId, String token);
}
