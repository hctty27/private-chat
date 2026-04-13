package com.privatechat;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.privatechat.mapper")
public class PrivateChatApplication {
    public static void main(String[] args) {
        SpringApplication.run(PrivateChatApplication.class, args);
    }
}
