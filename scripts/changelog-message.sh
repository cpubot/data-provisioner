#!/bin/bash

sed -i "s/### vNEXT/### v$npm_package_version/" CHANGELOG.md
git add CHANGELOG.md