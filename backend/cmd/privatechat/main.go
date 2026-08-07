package main

import (
	"fmt"
	"log"
	"os"

	"privatechat/internal/app"
	"privatechat/internal/config"
	"privatechat/internal/migration"
)

const (
	commandServe   = "serve"
	commandMigrate = "migrate"
)

func selectCommand(args []string) (string, error) {
	if len(args) == 0 {
		return commandServe, nil
	}
	if len(args) == 1 && args[0] == commandMigrate {
		return commandMigrate, nil
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
