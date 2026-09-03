package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"privatechat/internal/model"

	"github.com/lionsoul2014/ip2region/binding/golang/service"
)

type cityResolver interface {
	Resolve(context.Context, string) (string, error)
}

type regionSearcher interface {
	Search(any) (string, error)
}

type ip2RegionCityResolver struct {
	searcher regionSearcher
}

func newIP2RegionCityResolver(v4Path, v6Path string) cityResolver {
	var v4Config, v6Config *service.Config

	if path := strings.TrimSpace(v4Path); path != "" {
		cfg, err := service.NewV4Config(service.VIndexCache, path, 8)
		if err != nil {
			log.Printf("ip2region IPv4 database disabled: %v", err)
		} else {
			v4Config = cfg
		}
	}

	if path := strings.TrimSpace(v6Path); path != "" {
		cfg, err := service.NewV6Config(service.VIndexCache, path, 8)
		if err != nil {
			log.Printf("ip2region IPv6 database disabled: %v", err)
		} else {
			v6Config = cfg
		}
	}

	if v4Config == nil && v6Config == nil {
		log.Printf("ip2region city resolver disabled: no usable XDB database")
		return nil
	}

	searcher, err := service.NewIp2Region(v4Config, v6Config)
	if err != nil {
		log.Printf("ip2region city resolver disabled: %v", err)
		return nil
	}
	return &ip2RegionCityResolver{searcher: searcher}
}

func (r *ip2RegionCityResolver) Resolve(ctx context.Context, rawIP string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}

	ip := net.ParseIP(strings.TrimSpace(rawIP))
	if ip == nil {
		return "", fmt.Errorf("invalid client ip")
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return "", fmt.Errorf("client ip is not publicly routable")
	}

	region, err := r.searcher.Search(ip.String())
	if err != nil {
		return "", fmt.Errorf("query ip2region: %w", err)
	}
	return cityFromIP2Region(region)
}

func cityFromIP2Region(region string) (string, error) {
	parts := strings.Split(region, "|")
	if len(parts) < 3 {
		return "", fmt.Errorf("invalid ip2region result")
	}

	country := cleanRegionPart(parts[0])
	province := cleanRegionPart(parts[1])
	city := cleanRegionPart(parts[2])
	if country == "" || strings.EqualFold(country, "Reserved") {
		return "", fmt.Errorf("ip2region returned no public region")
	}
	if province == "" && city == "" {
		return "", fmt.Errorf("ip2region returned no city")
	}
	if province == "" {
		return city, nil
	}
	if city == "" {
		return province, nil
	}
	if administrativeBase(province) == administrativeBase(city) {
		if len(city) >= len(province) {
			return city, nil
		}
		return province, nil
	}
	return province + city, nil
}

func cleanRegionPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" {
		return ""
	}
	return value
}

func administrativeBase(value string) string {
	value = strings.TrimSpace(value)
	for _, suffix := range []string{"特别行政区", "壮族自治区", "回族自治区", "维吾尔自治区", "自治区", "省", "市"} {
		value = strings.TrimSuffix(value, suffix)
	}
	return value
}

func (a *App) refreshUserCityOnLogin(userID int64, clientIP string) {
	if a.city == nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()

		city, err := a.city.Resolve(ctx, clientIP)
		if err != nil {
			log.Printf("refresh user city skipped for user %d: %v", userID, err)
			return
		}
		if err := a.db.WithContext(ctx).
			Model(&model.User{}).
			Where("id = ?", userID).
			Update("city", city).Error; err != nil {
			log.Printf("refresh user city failed for user %d: %v", userID, err)
		}
	}()
}
