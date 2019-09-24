#!/usr/bin/env bash

# Lists of how to install stuff
declare -A PACKAGES
PACKAGES[linux,alpine,x86_64,curl]="apk add curl"
PACKAGES[linux,alpine,x86_64,make]="apk add make"
PACKAGES[linux,debian,x86_64,curl]="apt-get install -y curl"
PACKAGES[linux,debian,x86_64,make]="apt-get install -y make"
PACKAGES[linux,gentoo,x86_64,curl]="emerge net-misc/curl"
PACKAGES[linux,gentoo,x86_64,make]="echo \"make is already in the base image\""

# List of requested packages
REQUESTED=()

# Defaults
ARCH="unknown"
PLATFORM="unknown"
DISTRO="unknown"

# Detect OS
if [[ `uname` == "Linux" ]]; then
  PLATFORM="linux"

  ARCH=$(uname -m)
  if [ -n "$(command -v lsb_release)" ]; then
    DISTRO=$(lsb_release -s -d)
  elif [ -f "/etc/os-release" ]; then
    DISTRO=$(grep ID /etc/os-release | sed 's/ID=//g' | tr -d '="')
  elif [ -f "/etc/debian_version" ]; then
    DISTRO="debian"
  elif [ -f "/etc/redhat-release" ]; then
    DISTRO=$(cat /etc/redhat-release)
  fi

fi

# Iterate through requested packages
while (( "$#" )); do
  case "$1" in
    -h|--help)
      echo ""
      echo "Usage: $0 [options] <package> [package] [...]"
      echo ""
      echo "Options:"
      echo "  -h --help  Show this usage"
      echo "  -l --list  Show a list of supported packages"
      echo ""
      exit 0
      ;;
    -l|--list)
      printf "%-8s | %-8s | %-8s | %-8s \n" "Platform" "Distro" "Arch" "Package"
      echo -en "-------- | -------- | -------- | -------- \n" 
      for details in "${!PACKAGES[@]}"; do
        echo $details
      done | sort | while IFS=, read platform distro arch pkg; do
        printf "%-8s | %-8s | %-8s | %-8s \n" "$platform" "$distro" "$arch" "$pkg"
      done
      ;;
    *)
      REQUESTED+=("$1")
      ;;
  esac
  shift
done

for pkg in "${REQUESTED[@]}"; do
  CMD=${PACKAGES[$PLATFORM,$DISTRO,$ARCH,$pkg]}
  if [ -z "$CMD" ]; then
    echo "Package '$pkg' not found or system not supported" >&2
    echo "  PLATFORM: $PLATFORM" >&2
    echo "  ARCH    : $ARCH" >&2
    echo "  DISTRO  : $DISTRO" >&2
    echo "  PACKAGE : $pkg" >&2
    exit 1
  fi
  bash -c "$CMD" || exit $?
done


