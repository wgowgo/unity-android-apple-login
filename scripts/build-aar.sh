#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JAVA_HOME에 JDK 17이 없습니다: $JAVA_HOME" >&2
  exit 1
fi

if [[ ! -x "$ANDROID/gradlew" ]]; then
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/gradle.zip" https://services.gradle.org/distributions/gradle-8.11.1-bin.zip
  unzip -q "$TMP/gradle.zip" -d "$TMP"
  "$TMP/gradle-8.11.1/bin/gradle" -p "$ANDROID" wrapper --gradle-version 8.11.1 --no-daemon
  rm -rf "$TMP"
fi

"$ANDROID/gradlew" -p "$ANDROID" :AppleLoginAndroid:assembleRelease --no-daemon
mkdir -p "$ROOT/unity/com.company.apple-login/Runtime/Plugins/Android"
cp "$ANDROID/AppleLoginAndroid/build/outputs/aar/AppleLoginAndroid-release.aar" \
  "$ROOT/unity/com.company.apple-login/Runtime/Plugins/Android/AppleLoginBridge.aar"
echo "AAR copied to Unity package"
