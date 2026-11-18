#!/usr/bin/env bash
set -euo pipefail

# Hash this dependency set, not the workflow containing Docker jobs.
./mvnw -B -ntp "$@" -s .mvn/public-repositories.xml -Pmutation dependency:go-offline
./mvnw -B -ntp "$@" -s .mvn/public-repositories.xml -f scripts/ci/maven-cache/pom.xml dependency:go-offline
