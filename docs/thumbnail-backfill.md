# Historical Thumbnail Backfill

历史图片在没有 `.thumb.jpg` 对象时仍会由 `/api/files/{fileId}/thumbnail` 回退到原图。为了让旧聊天图片也获得缩略图加载性能，可以在部署新版本后手动执行一次：

```bash
cd backend
go run ./cmd/privatechat backfill-thumbnails
```

如果使用已经构建好的后端二进制：

```bash
./private-chat-backend backfill-thumbnails
```

## 行为

- 仅扫描 `t_file.status = ready` 的历史文件，按 ID 分批处理。
- 识别 JPEG、PNG、GIF、WebP 历史图片。
- 缩略图固定写入 `<objectKey>.thumb.jpg`，最长边 640px，JPEG quality 80。
- 已存在缩略图会直接跳过，不会覆盖，因此命令可重复执行。
- 不修改原图、不修改消息、不修改 `fileId`，也不需要数据库 migration。
- 单个对象损坏、缺失或无法解码时会记录失败并继续处理其他文件；命令最终以非零状态返回，方便发现残留失败项。
- 原图读取限制为 100 MiB；解码前先读取图片尺寸并限制总像素数，避免压缩图片造成过大的内存分配。

## R2 权限

命令复用现有 `R2_ENDPOINT`、`R2_ACCESS_KEY`、`R2_SECRET_KEY`、`R2_BUCKET` 和 `R2_OBJECT_PREFIX` 配置。凭据需要对对应 Bucket 具备对象 `Head/Get/Put` 权限。Bucket 继续保持私有。

## 重跑

可以安全重复运行同一命令。已经成功生成的缩略图会被跳过，只会重试缺失或上次失败的对象。
