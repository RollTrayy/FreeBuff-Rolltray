#!/usr/bin/env bash
#
# Builds the CoreMIDI helper into com.rolltray.midideck.sdPlugin/bin/midi-bridge.
# Must run on macOS (CoreMIDI is Apple-only).
#
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_BUNDLE="$PLUGIN_DIR/com.rolltray.midideck.sdPlugin"
SOURCE="$PLUGIN_DIR/native/MidiBridge.swift"
OUTPUT="$PLUGIN_BUNDLE/bin/midi-bridge"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "error: this helper can only be built on macOS (CoreMIDI)." >&2
	echo "       Build it on the Mac that runs Stream Deck." >&2
	exit 1
fi

if ! xcrun --find swiftc >/dev/null 2>&1; then
	echo "error: the Swift compiler was not found." >&2
	echo "       Install the free Xcode Command Line Tools with:" >&2
	echo "         xcode-select --install" >&2
	exit 1
fi

SWIFTC="$(xcrun --find swiftc)"
mkdir -p "$PLUGIN_BUNDLE/bin"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

build_slice() {
	local arch="$1"
	local out="$2"
	"$SWIFTC" -O -wmo -swift-version 5 \
		-target "${arch}-apple-macos12.0" \
		-framework CoreMIDI -framework Foundation \
		-o "$out" "$SOURCE" 2>"$TMP_DIR/${arch}.log"
}

echo "Building the MIDI bridge (CoreMIDI)…"
if build_slice arm64 "$TMP_DIR/arm64" && build_slice x86_64 "$TMP_DIR/x86_64"; then
	xcrun lipo -create -output "$OUTPUT" "$TMP_DIR/arm64" "$TMP_DIR/x86_64"
	echo "  universal binary (arm64 + x86_64)"
else
	echo "  cross-arch build unavailable, building for this Mac only"
	"$SWIFTC" -O -wmo -swift-version 5 -framework CoreMIDI -framework Foundation -o "$OUTPUT" "$SOURCE"
fi

chmod 755 "$OUTPUT"
# Ad-hoc signature: keeps macOS happy with a locally built executable.
codesign --force --sign - "$OUTPUT" >/dev/null 2>&1 || true

echo "✔ $OUTPUT"
file "$OUTPUT"
