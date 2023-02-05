# /bin/bash
# 帮助同步 .yarnrc .npmrc
tmp_dir=$(dirname $(dirname "${BASH_SOURCE}"))
cd "$tmp_dir"
PROJECT_ROOT=$(pwd)
RUN_ROOT=/$(pwd)

projects=$(find "${PROJECT_ROOT}/packages" -type dir -maxdepth 1 | xargs -I {} basename {});
packages="packages";
ignoredirs="--ignore-dir=.yarn --ignore-dir=node_modules";

for project in $projects
do
    if [[ -d "${PROJECT_ROOT}/packages/${project}" ]];
    then
        ignoredirs="${ignoredirs} --ignore-dir=${PROJECT_ROOT}/packages/${project}/dist"
    fi;
done

ack $@ $ignoredirs