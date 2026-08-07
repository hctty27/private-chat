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
	cfg       config.Config
	db        *gorm.DB
	redis     *redis.Client
	storage   *minio.Client
	files     *fileManager
	jwt       *auth.JWTManager
	hub       *Hub
	relations relationAuthorizer
	loc       *time.Location
	router    *gin.Engine
}

func NewApp() (*App, error) {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if err := configureGinMode(cfg.GinMode); err != nil {
		return nil, err
	}

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

	fileManager := newFileManager(
		gormFileRepository{db: db},
		minioFileStorage{
			client: storageClient,
			bucket: cfg.StorageBucket,
			prefix: cfg.ObjectStoragePrefix,
		},
	)
	app := &App{
		cfg:       cfg,
		db:        db,
		redis:     rdb,
		storage:   storageClient,
		files:     fileManager,
		jwt:       auth.NewJWTManager(cfg.JWTSecret, cfg.JWTExpiration),
		hub:       NewHub(),
		relations: newRelationAuthorizer(db),
		loc:       loc,
	}
	router, err := app.routes()
	if err != nil {
		return nil, err
	}
	app.router = router
	return app, nil
}

func (a *App) Run() error {
	return a.router.Run(a.cfg.ListenAddr)
}

type readyCheck struct {
	name  string
	check func(context.Context) error
}

func (a *App) readyChecks() []readyCheck {
	return []readyCheck{
		{
			name: "postgres",
			check: func(ctx context.Context) error {
				sqlDB, err := a.db.DB()
				if err != nil {
					return err
				}
				return sqlDB.PingContext(ctx)
			},
		},
		{
			name: "redis",
			check: func(ctx context.Context) error {
				return a.redis.Ping(ctx).Err()
			},
		},
	}
}

func newReadyHandler(checks []readyCheck) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
		defer cancel()

		ok := true
		statuses := gin.H{}
		for _, item := range checks {
			if err := item.check(ctx); err != nil {
				ok = false
				statuses[item.name] = "unavailable"
				continue
			}
			statuses[item.name] = "ok"
		}

		if !ok {
			c.JSON(503, gin.H{"ok": false, "checks": statuses})
			return
		}
		c.JSON(200, gin.H{"ok": true, "checks": statuses})
	}
}

func configureGinMode(mode string) error {
	switch mode {
	case gin.DebugMode, gin.ReleaseMode, gin.TestMode:
		gin.SetMode(mode)
		return nil
	default:
		return fmt.Errorf("invalid GIN_MODE %q", mode)
	}
}

func (a *App) routes() (*gin.Engine, error) {
	r := gin.New()
	if err := r.SetTrustedProxies(a.cfg.TrustedProxies); err != nil {
		return nil, fmt.Errorf("set trusted proxies: %w", err)
	}
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})
	r.GET("/ready", newReadyHandler(a.readyChecks()))

	api := r.Group("/api")
	{
		authGroup := api.Group("/auth")
		authGroup.POST("/login", a.secureLoginHandler)

		protected := api.Group("")
		protected.Use(a.secureAuthMiddleware())
		{
			protected.POST("/auth/logout", a.logoutHandler)
			protected.GET("/contacts", a.contactsHandler)
			protected.GET("/messages/:targetId", a.requireContactParam("targetId"), a.messagesHandler)
			protected.POST("/file/presign-upload", a.filePresignUploadHandler)
			protected.POST("/files/:fileId/complete", a.fileCompleteHandler)
			protected.GET("/files/:fileId/content", a.fileContentHandler)

			// Compatibility window for migrated historical URLs only. New uploads use fileId.
			protected.GET("/file/download/:objectName", a.requireLegacyFileAccess(), a.downloadHandler)
		}
	}

	r.GET("/ws/chat", a.wsHandler)
	return r, nil
}
