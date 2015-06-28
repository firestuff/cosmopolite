CC ?= gcc
CFLAGS ?= -Wall -Werror -I/usr/local/include -fpic -O -g
LDFLAGS ?= -Wall -L/usr/local/lib -L. -O
LIBS ?= -lcurl -ljansson -luuid -lpthread

all: libcosmopolite.so

libcosmopolite.so: cosmopolite.o promise.o
	$(CC) -shared $(LDFLAGS) -o libcosmopolite.so cosmopolite.o promise.o $(LIBS)

%.o: %.c *.h
	$(CC) -c $(CFLAGS) $< -o $@

install: libcosmopolite.so cosmopolite.h promise.h
	cp libcosmopolite.so /usr/local/lib
	cp cosmopolite.h /usr/local/include
	cp promise.h /usr/local/include
	chown root /usr/local/lib/libcosmopolite.so /usr/local/include/cosmopolite.h /usr/local/include/promise.h
	chmod 0644 /usr/local/lib/libcosmopolite.so /usr/local/include/cosmopolite.h /usr/local/include/promise.h

clean:
	rm -f test libcosmopolite.so *.o

test: test.o cosmopolite.o promise.o
	$(CC) $(LDFLAGS) -o test test.o cosmopolite.o promise.o $(LIBS)

runtest: test
	valgrind --leak-check=full --show-reachable=yes --num-callers=20 --suppressions=suppressions ./test
