#!/bin/bash

while :; do
	valgrind --leak-check=full --show-reachable=yes --num-callers=20 --suppressions=suppressions ./test 2>&1 | tee torture.log
  if test $? != 0; then
    exit 1
  fi
done
