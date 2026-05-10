package app

import "strings"

func objectStorageKey(prefix, objectName string) string {
	prefix = strings.Trim(prefix, "/")
	if prefix == "" {
		return objectName
	}
	return prefix + "/" + strings.TrimLeft(objectName, "/")
}
