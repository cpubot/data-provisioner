build_tools_image = rival-docker.jfrog.io/rival/build-tools:latest

init:
	docker pull $(build_tools_image)
	docker run -i --rm -u $$(id -u):$$(id -g) -v $$(pwd):$$(pwd) -w $$(pwd) $(build_tools_image) build-tools generate dockerfile
	docker run -i --rm -u $$(id -u):$$(id -g) -v $$(pwd):$$(pwd) -w $$(pwd) $(build_tools_image) build-tools generate makefile

pipeline-initialize: init

-include build/base.mk