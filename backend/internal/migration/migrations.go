package migration

import "embed"

// Files contains all versioned SQL migrations compiled into the backend binary.
//
//go:embed sql/*.sql
var Files embed.FS
