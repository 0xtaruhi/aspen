#!/bin/sh
set -eu

# Skip RPM/DEB upgrades: the replacement package owns the installed rule.
case "${1:-}" in
  remove|purge|disappear|0) ;;
  *) exit 0 ;;
esac

if command -v udevadm >/dev/null 2>&1; then
  if ! udevadm control --reload-rules --timeout=5; then
    echo "Aspen: could not reload udev rules after removal; udev will reload them when it starts." >&2
  fi
fi

exit 0
