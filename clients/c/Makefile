CC ?= gcc
CFLAGS ?= -Wall -Werror -I/usr/local/include -fpic -O
LDFLAGS ?= -Wall -L/usr/local/lib -L. -O
LIBS ?= -lcurl -ljansson -luuid -lm -lpthread

all: libcosmopolite.so

test: test.o cosmopolite.o
	$(CC) $(LDFLAGS) -o test test.o cosmopolite.o $(LIBS)
	./test

libcosmopolite.so: cosmopolite.o
	$(CC) -shared $(LDFLAGS) -o libcosmopolite.so cosmopolite.o $(LIBS)

%.o: %.c *.h
	$(CC) -c $(CFLAGS) $< -o $@

install: libcosmopolite.so cosmopolite.h
	cp libcosmopolite.so /usr/local/lib
	cp cosmopolite.h /usr/local/include
	chown root /usr/local/lib/libcosmopolite.so /usr/local/include/cosmopolite.h
	chmod 0644 /usr/local/lib/libcosmopolite.so /usr/local/include/cosmopolite.h

clean:
	rm -f test libcosmopolite.so *.o
