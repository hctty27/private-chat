package com.privatechat.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.privatechat.dto.LoginRequest;
import com.privatechat.dto.LoginResponse;
import com.privatechat.entity.User;
import com.privatechat.mapper.UserMapper;
import com.privatechat.service.AuthService;
import com.privatechat.util.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder bCryptPasswordEncoder;
    private final JwtUtil jwtUtil;
    private final StringRedisTemplate redisTemplate;

    @Override
    public LoginResponse login(LoginRequest request) {
        User user = userMapper.selectOne(
                new LambdaQueryWrapper<User>().eq(User::getUsername, request.getUsername())
        );

        if (user == null || !bCryptPasswordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("用户名或密码错误");
        }

        String token = jwtUtil.generateToken(user.getId(), user.getNickname());
        
        // 将token存入Redis，用于单点登录控制
        // 设置24小时过期，与JWT过期时间一致
        redisTemplate.opsForValue().set("user:token:" + user.getId(), token, Duration.ofHours(24));
        
        return new LoginResponse(token, user.getId(), user.getNickname());
    }

    @Override
    public boolean validateUserToken(Long userId, String token) {
        String storedToken = redisTemplate.opsForValue().get("user:token:" + userId);
        return token.equals(storedToken);
    }
}
