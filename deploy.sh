#!/bin/bash
# This script is used to deploy the idem to the UAT server
# Usage: ./deploy.sh [git-tree-ish]
#    default git-tree-ish is "development"
#
# e.g. ./deploy.sh
#     or
#      ./deploy.sh faa0e9e08ec4febd6cd00e627a388310fa358541
GIT_TARGET=main

sudo service nginx stop
pm2 stop id
cd ~/proxy.idem.com.au
git stash && git checkout $GIT_TARGET && git pull origin $GIT_TARGET
rm -r dist
yarn install && yarn build
pm2 start id
sudo service nginx start
