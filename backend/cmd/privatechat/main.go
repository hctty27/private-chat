package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"privatechat/internal/app"
	"privatechat/internal/config"
	"privatechat/internal/migration"
	"privatechat/internal/thumbnailbackfill"
)

const (
	commandServe              = "serve"
	commandMigrate            = "migrate"
	commandBackfillThumbnails = "backfill-thumbnails"
)

func selectCommand(args []string) (string, error) {
	if len(args) == 0 {
		return commandServe, nil
	}
	if len(args) == 1 {
		switch args[0] {
		case commandMigrate, commandBackfillThumbnails:
			return args[0], nil
		}
	}
	return "", fmt.Errorf("unknown command %q", args[0])
}

func run(args []string) error {
	command, err := selectCommand(args)
	if err != nil {
		return err
	}

	switch command {
	case commandMigrate:
		if err := migration.Run(config.Load()); err != nil {
			return err
		}
		log.Println("database migrations are up to date")
		return nil
	case commandBackfillThumbnails:
		result, err := thumbnailbackfill.Run(context.Background(), config.Load())
		for _, failure := range result.Failures {
			log.Printf("thumbnail backfill failed: file_id=%d object=%q error=%v", failure.FileID, failure.ObjectKey, failure.Err)
		}
		log.Printf(
			"thumbnail backfill complete: scanned=%d eligible=%d created=%d existing=%d non_image=%d failed=%d",
			result.Scanned,
			result.Eligible,
			result.Created,
			result.SkippedExisting,
			result.SkippedNonImage,
			result.Failed,
		)
		return err
	case commandServe:
		srv, err := app.NewApp()
		if err != nil {
			return err
		}
		return srv.Run()
	default:
		return fmt.Errorf("unsupported command %q", command)
	}
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}
