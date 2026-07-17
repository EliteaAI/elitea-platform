package main

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const defaultHTTPAddress = ":8080"

func configuredHTTPAddress(lookup func(string) (string, bool)) (string, error) {
	if lookup == nil {
		return "", errors.New("HTTP address environment lookup is required")
	}
	address, ok := lookup("ELITEA_HTTP_ADDRESS")
	if !ok || address == "" {
		address = defaultHTTPAddress
	}
	if len(address) > 256 || strings.ContainsAny(address, "\r\n\x00") {
		return "", errors.New("ELITEA_HTTP_ADDRESS is invalid")
	}
	_, portValue, err := net.SplitHostPort(address)
	if err != nil {
		return "", errors.New("ELITEA_HTTP_ADDRESS must include a numeric TCP port")
	}
	port, err := strconv.Atoi(portValue)
	if err != nil || port <= 0 || port > 65535 || strconv.Itoa(port) != portValue {
		return "", errors.New("ELITEA_HTTP_ADDRESS must include a numeric TCP port")
	}
	return address, nil
}

func healthcheckURL(lookup func(string) (string, bool)) (string, error) {
	address, err := configuredHTTPAddress(lookup)
	if err != nil {
		return "", err
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "", err
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, port), Path: "/healthz"}).String(), nil
}
