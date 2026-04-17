package auth

import (
	"errors"
	"strconv"
	"time"

	"privatechat/internal/model"

	"github.com/golang-jwt/jwt/v5"
)

type JWTManager struct {
	secret []byte
	expiry time.Duration
}

func NewJWTManager(secret string, expiry time.Duration) *JWTManager {
	return &JWTManager{
		secret: []byte(secret),
		expiry: expiry,
	}
}

func (j *JWTManager) Generate(userID int64, nickname string) (string, error) {
	now := time.Now()
	claims := model.JWTClaims{
		Nickname: nickname,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(j.expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(j.secret)
}

func (j *JWTManager) Parse(tokenString string) (int64, string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &model.JWTClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return j.secret, nil
	}, jwt.WithLeeway(5*time.Second))
	if err != nil {
		return 0, "", err
	}
	claims, ok := token.Claims.(*model.JWTClaims)
	if !ok || !token.Valid {
		return 0, "", errors.New("invalid token")
	}
	userID, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return 0, "", err
	}
	return userID, claims.Nickname, nil
}
