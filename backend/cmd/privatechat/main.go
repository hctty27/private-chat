package main

import "privatechat/internal/app"

func main() {
	srv, err := app.NewApp()
	if err != nil {
		panic(err)
	}
	if err := srv.Run(); err != nil {
		panic(err)
	}
}
