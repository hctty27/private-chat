package app

import (
	"context"
	"errors"
	"testing"
)

type fakeRegionSearcher struct {
	region string
	err    error
	gotIP  string
}

func (f *fakeRegionSearcher) Search(ip any) (string, error) {
	f.gotIP, _ = ip.(string)
	return f.region, f.err
}

func TestIP2RegionResolverReturnsChineseCity(t *testing.T) {
	searcher := &fakeRegionSearcher{region: "中国|浙江省|杭州市|电信|CN"}
	resolver := &ip2RegionCityResolver{searcher: searcher}

	got, err := resolver.Resolve(context.Background(), "8.8.8.8")
	if err != nil {
		t.Fatalf("resolve location: %v", err)
	}
	if got != "浙江省杭州市" {
		t.Fatalf("expected city-level area, got %q", got)
	}
	if searcher.gotIP != "8.8.8.8" {
		t.Fatalf("unexpected searched IP %q", searcher.gotIP)
	}
}

func TestIP2RegionResolverSupportsIPv6(t *testing.T) {
	searcher := &fakeRegionSearcher{region: "中国|广东省|深圳市|电信|CN"}
	resolver := &ip2RegionCityResolver{searcher: searcher}

	got, err := resolver.Resolve(context.Background(), "240e:3b7:3272:d8d0:db09:c067:8d59:539e")
	if err != nil {
		t.Fatalf("resolve IPv6 location: %v", err)
	}
	if got != "广东省深圳市" {
		t.Fatalf("expected IPv6 city-level area, got %q", got)
	}
}

func TestIP2RegionResolverRejectsPrivateIP(t *testing.T) {
	searcher := &fakeRegionSearcher{region: "中国|浙江省|杭州市|电信|CN"}
	resolver := &ip2RegionCityResolver{searcher: searcher}

	if _, err := resolver.Resolve(context.Background(), "172.16.0.10"); err == nil {
		t.Fatal("expected private IP to be rejected")
	}
	if searcher.gotIP != "" {
		t.Fatal("private IP must not reach the database searcher")
	}
}

func TestIP2RegionResolverPropagatesSearchFailure(t *testing.T) {
	searcher := &fakeRegionSearcher{err: errors.New("xdb read failed")}
	resolver := &ip2RegionCityResolver{searcher: searcher}

	if _, err := resolver.Resolve(context.Background(), "8.8.8.8"); err == nil {
		t.Fatal("expected search failure")
	}
}

func TestCityFromIP2RegionDeduplicatesMunicipality(t *testing.T) {
	got, err := cityFromIP2Region("中国|北京|北京市|联通|CN")
	if err != nil {
		t.Fatalf("parse municipality: %v", err)
	}
	if got != "北京市" {
		t.Fatalf("expected municipality without duplicate province, got %q", got)
	}
}

func TestCityFromIP2RegionRejectsReservedResult(t *testing.T) {
	if _, err := cityFromIP2Region("Reserved|Reserved|Reserved|0|0"); err == nil {
		t.Fatal("expected reserved IP result to be rejected")
	}
}
