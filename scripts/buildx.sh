#!/bin/bash
set -o errexit
# 运行cmcli

### get project dir
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
readonly PROJECT_ROOT="$(dirname $DIR)"
RUN_ROOT="$PROJECT_ROOT"
cd $PROJECT_ROOT;

export $(cat .buildxenv | xargs)

readonly PROJECT_NAME="sodiumbundler";
readonly RELEASE_NAME=${OMNIBUS_RELEASE:-"default"}
readonly IMAGE_TAG=${VERSION:-$(git rev-parse --short HEAD)}

get_current_version() {
    echo ${IMAGE_TAG}
}

get_docker_tag() {
    appname=${1:-""}
    version=${2:-""}
    echo "${DOCKER_NAMESPACE}/${appname}:${version}"
}

echo "building ${PROJECT_NAME} with docker ..."

version=$(get_current_version)
image_name=$(get_docker_tag ${PROJECT_NAME} ${version})


# build 服务镜像ss
DOCKER_BUILDKIT=1 docker build . -t ${image_name} -f "${RUN_ROOT}/docker/Dockerfile" --build-arg version=${version}

pushImageToRepo() {
     local TEMP_IMAGE_NAME=$1
     local TEMP_PROJECT_NAME=$2
     # 因为image repository 禁止了同一个标签重复写入;
     # 如果push CI 事件和 tag CI 事情使用同一个 commit.sha 去构建 image 会产生一个中断错误;
     # 需要把该类型的错误忽略掉
     if [[ ! $(docker push -q $TEMP_IMAGE_NAME 2> ${TEMP_PROJECT_NAME}err.log ) ]]; then
         echo "docker push raw error:$(cat ${TEMP_PROJECT_NAME}err.log)"
     fi

     if [[  -s ${TEMP_PROJECT_NAME}err.log  && ! $(cat ${TEMP_PROJECT_NAME}err.log | grep 'cannot be overwritten because the repository is immutable') ]]; then
        echo "Other errors needs exit"
        exit 1
     fi
}

pushImageToRepo $image_name $PROJECT_NAME