variable "TAG" {
  default = "dev"
}

variable "REGISTRY" {
  default = "eliteaai"
}

group "default" {
  targets = ["elitea-main"]
}

target "elitea-main" {
  context    = "./services/elitea-main"
  dockerfile = "Dockerfile"
  tags       = ["${REGISTRY}/elitea-main:${TAG}"]
  cache-from = ["type=gha,scope=elitea-main"]
  cache-to   = ["type=gha,mode=max,scope=elitea-main"]
  platforms  = ["linux/amd64", "linux/arm64"]
}
