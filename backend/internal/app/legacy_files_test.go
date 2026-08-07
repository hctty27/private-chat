package app

import (
	"context"
	"testing"

	"privatechat/internal/model"
)

func (r *fakeFileRepository) FindByObjectKey(_ context.Context, objectKey string) ([]model.File, error) {
	files := make([]model.File, 0)
	for _, file := range r.files {
		if file.ObjectKey == objectKey && file.Status == model.FileStatusReady {
			files = append(files, file)
		}
	}
	return files, nil
}

func TestLegacyObjectAllowedRequiresConversationMembership(t *testing.T) {
	repo := newFakeFileRepository(
		model.File{ID: 21, ObjectKey: "legacy.jpg", OwnerID: 1, ConversationID: "1_2", Status: model.FileStatusReady},
		model.File{ID: 22, ObjectKey: "shared.jpg", OwnerID: 1, ConversationID: "1_2", Status: model.FileStatusReady},
		model.File{ID: 23, ObjectKey: "shared.jpg", OwnerID: 3, ConversationID: "3_4", Status: model.FileStatusReady},
	)
	manager := newFileManager(repo, &fakeFileStorage{})

	allowed, err := manager.LegacyObjectAllowed(context.Background(), 2, "legacy.jpg")
	if err != nil || !allowed {
		t.Fatalf("expected conversation participant to access legacy object, allowed=%v err=%v", allowed, err)
	}
	allowed, err = manager.LegacyObjectAllowed(context.Background(), 3, "legacy.jpg")
	if err != nil {
		t.Fatalf("legacy lookup: %v", err)
	}
	if allowed {
		t.Fatal("expected outsider to be denied legacy object")
	}
	allowed, err = manager.LegacyObjectAllowed(context.Background(), 4, "shared.jpg")
	if err != nil || !allowed {
		t.Fatalf("expected second migrated conversation to authorize shared object, allowed=%v err=%v", allowed, err)
	}
}

func TestLegacyObjectAllowedRejectsPathTraversal(t *testing.T) {
	manager := newFileManager(newFakeFileRepository(), &fakeFileStorage{})
	for _, name := range []string{"../secret", "nested/object", `nested\\object`} {
		allowed, err := manager.LegacyObjectAllowed(context.Background(), 1, name)
		if err != nil {
			t.Fatalf("lookup %q: %v", name, err)
		}
		if allowed {
			t.Fatalf("expected %q to be denied", name)
		}
	}
}
