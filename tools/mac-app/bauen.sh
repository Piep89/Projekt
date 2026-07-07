#!/bin/bash
# Baut GGP.app für macOS (Apple Silicon und Intel) – lauffähig auf jedem System,
# das nodejs.org erreicht. Ergebnis: desktop/dist/GGP-macOS-*.zip
set -euo pipefail

NODE_VERSION="${GGP_NODE_VERSION:-22.17.0}"
HIER="$(cd "$(dirname "$0")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
DIST="$WURZEL/desktop/dist"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

VERSION="$(node -e "console.log(require('$WURZEL/package.json').version)")"
mkdir -p "$DIST"

echo "==> Produktions-Abhängigkeiten in Staging installieren"
STAGING="$ARBEIT/app"
mkdir -p "$STAGING"
cp "$WURZEL/package.json" "$STAGING/"
[ -f "$WURZEL/package-lock.json" ] && cp "$WURZEL/package-lock.json" "$STAGING/"
cp -R "$WURZEL/server" "$STAGING/server"
cp -R "$WURZEL/public" "$STAGING/public"
rm -rf "$STAGING/server/data"
(cd "$STAGING" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

for ARCH in arm64 x64; do
  echo "==> Node ${NODE_VERSION} für darwin-${ARCH} laden"
  TARBALL="$ARBEIT/node-$ARCH.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz" -o "$TARBALL"
  tar -xzf "$TARBALL" -C "$ARBEIT" "node-v${NODE_VERSION}-darwin-${ARCH}/bin/node"

  echo "==> GGP.app (${ARCH}) zusammensetzen"
  APP="$ARBEIT/${ARCH}/GGP.app"
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  sed "s/__VERSION__/${VERSION}/g" "$HIER/Info.plist" > "$APP/Contents/Info.plist"
  cp "$HIER/starter.sh" "$APP/Contents/MacOS/ggp"
  chmod 755 "$APP/Contents/MacOS/ggp"
  cp "$HIER/icons/ggp.icns" "$APP/Contents/Resources/ggp.icns"
  cp "$ARBEIT/node-v${NODE_VERSION}-darwin-${ARCH}/bin/node" "$APP/Contents/Resources/node"
  chmod 755 "$APP/Contents/Resources/node"
  cp -R "$STAGING" "$APP/Contents/Resources/app"

  NAME="GGP-macOS-$([ "$ARCH" = arm64 ] && echo AppleSilicon || echo Intel)-v${VERSION}.zip"
  echo "==> ${NAME} packen"
  (cd "$ARBEIT/${ARCH}" && zip -qryX "$DIST/$NAME" GGP.app)
done

echo
echo "Fertig:"
ls -lh "$DIST"/GGP-macOS-*.zip
echo
echo "Hinweis: Die App ist nicht signiert. Auf dem Mac beim ersten Start:"
echo "  Rechtsklick auf GGP.app -> Öffnen -> Öffnen bestätigen"
echo "  (oder: xattr -dc /Applications/GGP.app)"
