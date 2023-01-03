# /bin/bash
# 帮助同步 .yarnrc .npmrc
tmp_dir=$(dirname $(dirname "${BASH_SOURCE}"))
cd "$tmp_dir"
PROJECT_ROOT=$(pwd)
RUN_ROOT=/$(pwd)

projects=$(find "${PROJECT_ROOT}/packages" -type dir -maxdepth 1 | xargs -I {} basename {});
packages="packages";

for project in $projects
do
    if [[ -d "${PROJECT_ROOT}/packages/${project}" ]];
    then
        rm -rf "${PROJECT_ROOT}/packages/${project}/pnpm-lock.yaml"
    fi;
done