package model

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	FileStatusPending = "pending"
	FileStatusReady   = "ready"
)

type APIResponse[T any] struct {
	Code    int    `json:"code"`
	Data    T      `json:"data"`
	Message string `json:"message,omitempty"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token    string `json:"token"`
	UserID   int64  `json:"userId"`
	Nickname string `json:"nickname"`
}

type ContactDTO struct {
	UserID        int64   `json:"userId"`
	Nickname      string  `json:"nickname"`
	Online        bool    `json:"online"`
	LastSeenAt    *string `json:"lastSeenAt"`
	LastMessage   *string `json:"lastMessage"`
	LastMessageAt *string `json:"lastMessageTime"`
	UnreadCount   int     `json:"unreadCount"`
}

type MessageDTO struct {
	ID             int64   `json:"id"`
	ConversationID string  `json:"conversationId"`
	SenderID       int64   `json:"senderId"`
	ReceiverID     int64   `json:"receiverId"`
	MsgType        int     `json:"msgType"`
	Content        *string `json:"content"`
	ClientMsgID    *string `json:"clientMsgId,omitempty"`
	FileID         *int64  `json:"fileId,omitempty"`
	FileURL        *string `json:"fileUrl"`
	FileName       *string `json:"fileName"`
	FileSize       *int64  `json:"fileSize"`
	IsRead         int     `json:"isRead"`
	CreatedAt      string  `json:"createdAt"`
}

type MessagePageDTO struct {
	Messages []MessageDTO `json:"messages"`
	HasMore  bool         `json:"hasMore"`
}

type FileUploadDTO struct {
	FileID   int64  `json:"fileId"`
	URL      string `json:"url"`
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
}

type FilePresignUploadRequest struct {
	ReceiverID  int64  `json:"receiverId"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	FileSize    int64  `json:"fileSize"`
}

type FilePresignUploadDTO struct {
	FileID    int64             `json:"fileId"`
	UploadURL string            `json:"uploadUrl"`
	URL       string            `json:"url"`
	FileName  string            `json:"fileName"`
	FileSize  int64             `json:"fileSize"`
	Headers   map[string]string `json:"headers"`
}

type User struct {
	ID         int64      `gorm:"column:id;primaryKey;autoIncrement"`
	Username   string     `gorm:"column:username"`
	Password   string     `gorm:"column:password"`
	Nickname   string     `gorm:"column:nickname"`
	LastSeenAt *time.Time `gorm:"column:last_seen_at"`
	CreatedAt  time.Time  `gorm:"column:created_at;autoCreateTime"`
}

func (User) TableName() string { return "t_user" }

type Relation struct {
	ID        int64     `gorm:"column:id;primaryKey;autoIncrement"`
	UserID    int64     `gorm:"column:user_id"`
	TargetID  int64     `gorm:"column:target_id"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (Relation) TableName() string { return "t_relation" }

type File struct {
	ID                  int64      `gorm:"column:id;primaryKey;autoIncrement"`
	ObjectKey           string     `gorm:"column:object_key"`
	OwnerID             int64      `gorm:"column:owner_id"`
	ConversationID      string     `gorm:"column:conversation_id"`
	OriginalName        string     `gorm:"column:original_name"`
	ExpectedSize        int64      `gorm:"column:expected_size"`
	ActualSize          *int64     `gorm:"column:actual_size"`
	ClaimedContentType  string     `gorm:"column:claimed_content_type"`
	DetectedContentType *string    `gorm:"column:detected_content_type"`
	Status              string     `gorm:"column:status"`
	CreatedAt           time.Time  `gorm:"column:created_at;autoCreateTime"`
	ConfirmedAt         *time.Time `gorm:"column:confirmed_at"`
}

func (File) TableName() string { return "t_file" }

type Message struct {
	ID             int64     `gorm:"column:id;primaryKey;autoIncrement"`
	ConversationID string    `gorm:"column:conversation_id"`
	SenderID       int64     `gorm:"column:sender_id"`
	ReceiverID     int64     `gorm:"column:receiver_id"`
	MsgType        int       `gorm:"column:msg_type"`
	Content        *string   `gorm:"column:content"`
	ClientMsgID    *string   `gorm:"column:client_msg_id"`
	FileID         *int64    `gorm:"column:file_id"`
	FileURL        *string   `gorm:"column:file_url"`
	FileName       *string   `gorm:"column:file_name"`
	FileSize       *int64    `gorm:"column:file_size"`
	IsRead         int       `gorm:"column:is_read"`
	CreatedAt      time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (Message) TableName() string { return "t_message" }

type JWTClaims struct {
	Nickname string `json:"nickname"`
	jwt.RegisteredClaims
}
