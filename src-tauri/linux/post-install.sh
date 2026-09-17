#!/bin/sh
set -eu

# Debian passes "configure"; RPM passes the installed package count (1 or more).
case "${1:-}" in
  configure|[1-9]*) ;;
  *) exit 0 ;;
esac

if ! command -v udevadm >/dev/null 2>&1; then
  echo "Aspen: udevadm is unavailable; USB access will be configured when udev is available." >&2
  exit 0
fi

# Offline image/chroot installs may have no running udev daemon.
if ! udevadm control --reload-rules --timeout=5; then
  echo "Aspen: could not reload udev rules; reconnect the board after udev starts." >&2
  exit 0
fi

if ! udevadm trigger --action=change --subsystem-match=usb \
  --attr-match=idVendor=2200 --attr-match=idProduct=2008; then
  echo "Aspen: could not refresh board permissions; unplug and reconnect the board." >&2
fi

exit 0
