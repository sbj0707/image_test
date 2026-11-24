IMAGE_NAME ?= orbit-user-management
IMAGE_TAG ?= latest
export IMAGE_NAME IMAGE_TAG

.PHONY: build up down logs test save
build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
up:
	docker compose up -d --wait

down:
	docker compose down
logs:
	docker compose logs -f app
test:
	python3 -m unittest discover -s backend/tests -v
save:
	docker image save -o orbit-user-management.tar $(IMAGE_NAME):$(IMAGE_TAG)
