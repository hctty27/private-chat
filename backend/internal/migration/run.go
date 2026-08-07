package migration

import (
	"errors"
	"fmt"

	"privatechat/internal/config"
	pdb "privatechat/internal/platform/db"

	migrate "github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

type upRunner interface {
	Up() error
}

func runUp(r upRunner) error {
	err := r.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}

func Run(cfg config.Config) error {
	sqlDB, err := pdb.OpenPostgresSQL(cfg)
	if err != nil {
		return fmt.Errorf("open postgres for migrations: %w", err)
	}

	sourceDriver, err := iofs.New(Files, "sql")
	if err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("open embedded migrations: %w", err)
	}

	databaseDriver, err := postgres.WithInstance(sqlDB, &postgres.Config{})
	if err != nil {
		_ = sourceDriver.Close()
		_ = sqlDB.Close()
		return fmt.Errorf("create postgres migration driver: %w", err)
	}

	runner, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", databaseDriver)
	if err != nil {
		_ = sourceDriver.Close()
		_ = databaseDriver.Close()
		return fmt.Errorf("create migration runner: %w", err)
	}

	runErr := runUp(runner)
	sourceCloseErr, databaseCloseErr := runner.Close()
	if runErr != nil {
		return fmt.Errorf("apply migrations: %w", runErr)
	}
	if sourceCloseErr != nil {
		return fmt.Errorf("close migration source: %w", sourceCloseErr)
	}
	if databaseCloseErr != nil {
		return fmt.Errorf("close migration database: %w", databaseCloseErr)
	}
	return nil
}
