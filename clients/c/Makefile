CC ?= gcc
CFLAGS ?= -Wall -Werror -I/usr/local/include -fpic
LDFLAGS ?= -Wall -L/usr/local/lib -L.
LIBS ?= -lcurl -ljansson

test: test.o libcosmopolite.so
	$(CC) $(LDFLAGS) -o test test.o -lcosmopolite $(LIBS)

libcosmopolite.so: cosmopolite.o
	$(CC) -shared $(LDFLAGS) -o libcosmopolite.so cosmopolite.o

%.o: %.c
	$(CC) -c $(CFLAGS) $< -o $@
