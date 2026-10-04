#!/bin/sh
# Remove everything macos/install.sh created. Your fl config and upload history are left alone.

set -eu

services="$HOME/Library/Services"
bin_dir="$HOME/.local/bin"
pbs=/System/Library/CoreServices/pbs

for name in "Share via flashlink" "Share via flashlink (default lifetime)"; do
  if [ -e "$services/$name.workflow" ]; then
    rm -rf "${services:?}/$name.workflow"
    echo "removed: $services/$name.workflow"
  fi
done

if [ -e "$bin_dir/fl-quick" ]; then
  rm -f "$bin_dir/fl-quick"
  echo "removed: $bin_dir/fl-quick"
fi

data_dir=${FLASHLINK_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/flashlink}
if [ -e "$data_dir/bin/fl" ]; then
  rm -f "$data_dir/bin/fl"
  rmdir "$data_dir/bin" 2>/dev/null || true
  echo "removed: $data_dir/bin/fl"
fi

if [ -e "$data_dir/notify" ]; then
  rm -rf "${data_dir:?}/notify"
  echo "removed: $data_dir/notify"
fi

config_dir=${FLASHLINK_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/flashlink}
if [ -e "$config_dir/quick-action-path" ]; then
  rm -f "$config_dir/quick-action-path"
  echo "removed: $config_dir/quick-action-path"
fi

if [ -x "$pbs" ]; then
  "$pbs" -flush >/dev/null 2>&1 || true
fi
echo "Done. Config and history were not touched (see \`fl config path\`)."
