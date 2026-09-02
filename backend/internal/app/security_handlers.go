package app

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func (a *App) secureLoginHandler(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, "请求参数错误")
		return
	}

	username := strings.TrimSpace(req.Username)
	var user model.User
	if err := a.db.WithContext(c.Request.Context()).Where("username = ?", username).First(&user).Error; err != nil {
		respondError(c, http.StatusUnauthorized, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		respondError(c, http.StatusUnauthorized, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	token, err := a.jwt.Generate(user.ID, user.Nickname)
	if err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "登录失败")
		return
	}
	if err := a.redis.Set(c.Request.Context(), userTokenKey(user.ID), token, a.cfg.JWTExpiration).Err(); err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "登录失败")
		return
	}

	http.SetCookie(c.Writer, newAuthCookie(token, a.cfg.JWTExpiration, a.cfg.AuthCookieSecure))
	a.kickUser(user.ID, "您的账号在其他地方登录")
	respondSuccess(c, model.LoginResponse{
		UserID:   user.ID,
		Nickname: user.Nickname,
	})
}

func (a *App) secureAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := authTokenFromRequest(c.Request)
		if token == "" {
			unauthorized(c)
			return
		}

		userID, nickname, err := a.jwt.Parse(token)
		if err != nil {
			unauthorized(c)
			return
		}

		stored, err := a.redis.Get(c.Request.Context(), userTokenKey(userID)).Result()
		if err != nil || stored != token {
			unauthorized(c)
			return
		}

		c.Set("userID", userID)
		c.Set("nickname", nickname)
		c.Next()
	}
}

func (a *App) keepAliveHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	token := authTokenFromRequest(c.Request)
	if token == "" {
		unauthorized(c)
		return
	}

	key := userTokenKey(userID)
	ttl, err := a.redis.TTL(c.Request.Context(), key).Result()
	if err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "登录状态续期失败")
		return
	}
	if ttl > a.cfg.SessionRenewWindow {
		respondSuccess(c, gin.H{"renewed": false})
		return
	}

	renewed, err := a.redis.Expire(c.Request.Context(), key, a.cfg.JWTExpiration).Result()
	if err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "登录状态续期失败")
		return
	}
	if !renewed {
		unauthorized(c)
		return
	}

	http.SetCookie(c.Writer, newAuthCookie(token, a.cfg.JWTExpiration, a.cfg.AuthCookieSecure))
	respondSuccess(c, gin.H{"renewed": true})
}

func (a *App) logoutHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}
	if err := a.redis.Del(c.Request.Context(), userTokenKey(userID), onlineKey(userID)).Err(); err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "退出登录失败")
		return
	}

	http.SetCookie(c.Writer, expiredAuthCookie(a.cfg.AuthCookieSecure))
	a.kickUser(userID, "您已退出登录")
	respondSuccess(c, gin.H{})
}

func (a *App) requireContactParam(param string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := getUserID(c)
		if !ok {
			unauthorized(c)
			return
		}
		targetID, err := strconv.ParseInt(c.Param(param), 10, 64)
		if err != nil || targetID <= 0 {
			respondError(c, http.StatusBadRequest, http.StatusBadRequest, "目标用户无效")
			c.Abort()
			return
		}
		if err := a.requireContact(c.Request.Context(), userID, targetID); err != nil {
			if errors.Is(err, errContactForbidden) {
				forbidden(c, "无权访问该会话")
				return
			}
			respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "联系人关系校验失败")
			c.Abort()
			return
		}
		c.Next()
	}
}
