package app

import (
	"context"
	"fmt"
	"time"

	"privatechat/internal/auth"
	"privatechat/internal/config"
	pdb "privatechat/internal/platform/db"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type App struct {
	cfg     config.Config
	db      *gorm.DB
	redis   *redis.Client
	storage *minio.Client
	jwt     *auth.JWTManager
	hub     *Hub
	loc     *time.Location
	router  *gin.Engine
}

func NewApp() (*App, error) {
	cfg := config.Load()
	loc, err := time.LoadLocation(cfg.TimeZone)
	if err != nil {
		loc = time.Local
	}

	db, err := pdb.OpenPostgres(cfg)
	if err != nil {
		return nil, err
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       0,
	})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	storageClient, err := pdb.NewObjectStorageClient(cfg)
	if err != nil {
		return nil, err
	}
	if err := pdb.EnsureBucket(context.Background(), storageClient, cfg.StorageBucket); err != nil {
		return nil, err
	}

	app := &App{
		cfg:     cfg,
		db:      db,
		redis:   rdb,
		storage: storageClient,
		jwt:     auth.NewJWTManager(cfg.JWTSecret, cfg.JWTExpiration),
		hub:     NewHub(),
		loc:     loc,
	}
	app.router = app.routes()
	return app, nil
}

func (a *App) Run() error {
	return a.router.Run(a.cfg.ListenAddr)
}

func (a *App) routes() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	api := r.Group("/api")
	{
		authGroup := api.Group("/auth")
		authGroup.POST("/login", a.loginHandler)

		protected := api.Group("")
		protected.Use(a.authMiddleware())
		{
			protected.GET("/contacts", a.contactsHandler)
			protected.GET("/messages/:targetId", a.messagesHandler)
			protected.POST("/file/presign-upload", a.presignUploadHandler)
			protected.POST("/file/upload", a.uploadHandler)
		}
		api.GET("/file/download/:objectName", a.downloadHandler)
	}

	r.GET("/ws/chat", a.wsHandler)
	return r
}
