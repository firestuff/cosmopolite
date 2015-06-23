#!/bin/bash

set -e
export COSMO_DEBUG=

make test

while :; do
  date > torture.log
	valgrind --leak-check=full --show-reachable=yes --num-callers=20 --suppressions=suppressions ./test >> torture.log 2>&1
done
