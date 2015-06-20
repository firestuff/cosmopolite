#!/bin/bash

set -e

make test

while :; do
	valgrind --leak-check=full --show-reachable=yes --num-callers=20 --suppressions=suppressions ./test > torture.log 2>&1
done
