#!/bin/sh
# Remove everything macos/install.sh created. Your r2fl config and upload history are left alone.

set -eu

services="$HOME/Library/Services"
bin_dir="$HOME/.local/bin"
pbs=/System/Library/CoreServices/pbs

for name in "Share via r2-fastlink" "Share via r2-fastlink (default lifetime)"; do
  if [ -e "$services/$name.workflow" ]; then
    rm -rf "${services:?}/$name.workflow"
    echo "removed: $services/$name.workflow"
  fi
done

if [ -e "$bin_dir/r2fl-quick" ]; then
  rm -f "$bin_dir/r2fl-quick"
  echo "removed: $bin_dir/r2fl-quick"
fi

data_dir=${R2FL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/r2fl}
if [ -e "$data_dir/bin/r2fl" ]; then
  rm -f "$data_dir/bin/r2fl"
  rmdir "$data_dir/bin" 2>/dev/null || true
  echo "removed: $data_dir/bin/r2fl"
fi

config_dir=${R2FL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/r2fl}
if [ -e "$config_dir/quick-action-path" ]; then
  rm -f "$config_dir/quick-action-path"
  echo "removed: $config_dir/quick-action-path"
fi

if [ -x "$pbs" ]; then
  "$pbs" -flush >/dev/null 2>&1 || true
fi
echo "Done. Config and history were not touched (see \`r2fl config path\`)."
