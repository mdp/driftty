# Build-only container: the exported executable does not need Docker or Alpine.
FROM alpine:3.22 AS build

RUN apk add --no-cache build-base cmake curl python3 linux-headers libuv-dev libuv-static \
    openssl-dev openssl-libs-static zlib-dev zlib-static

WORKDIR /build
RUN curl -fsSL --retry 3 https://s3.amazonaws.com/json-c_releases/releases/json-c-0.18.tar.gz -o json-c.tar.gz \
    && echo '876ab046479166b869afc6896d288183bbc0e5843f141200c677b3e8dfb11724  json-c.tar.gz' | sha256sum -c - \
    && tar -xzf json-c.tar.gz \
    && cmake -S json-c-0.18 -B json-c-build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
    && cmake --build json-c-build --parallel 4 \
    && cmake --install json-c-build

RUN curl -fsSL --retry 3 https://codeload.github.com/warmcat/libwebsockets/tar.gz/refs/tags/v4.3.5 -o libwebsockets.tar.gz \
    && echo '87f99ad32803ed325fceac5327aae1f5c1b417d54ee61ad36cffc8df5f5ab276  libwebsockets.tar.gz' | sha256sum -c - \
    && tar -xzf libwebsockets.tar.gz \
    # Upstream ttyd's cross-build uses these same static-link CMake fixes.
    && sed -i 's/ websockets_shared//g' libwebsockets-4.3.5/cmake/libwebsockets-config.cmake.in \
    && sed -i 's/ OR PC_OPENSSL_FOUND//g; /PC_OPENSSL/d' libwebsockets-4.3.5/lib/tls/CMakeLists.txt \
    && cmake -S libwebsockets-4.3.5 -B lws-build \
      -DCMAKE_BUILD_TYPE=Release -DLWS_WITH_SHARED=OFF -DLWS_WITH_STATIC=ON \
      -DLWS_WITH_LIBUV=ON -DLWS_WITH_EVLIB_PLUGINS=OFF \
      -DLIBUV_LIBRARIES=/usr/lib/libuv.a \
      -DLWS_WITHOUT_TESTAPPS=ON -DLWS_WITHOUT_EXTENSIONS=ON \
      -DLWS_WITH_HTTP2=OFF -DOPENSSL_USE_STATIC_LIBS=TRUE \
    && cmake --build lws-build --parallel 4 \
    && cmake --install lws-build

RUN curl -fsSL --retry 3 https://codeload.github.com/tsl0922/ttyd/tar.gz/refs/tags/1.7.7 -o ttyd.tar.gz \
    && echo '039dd995229377caee919898b7bd54484accec3bba49c118e2d5cd6ec51e3650  ttyd.tar.gz' | sha256sum -c - \
    && tar -xzf ttyd.tar.gz

COPY configure-ttyd.py defaults.c /native/
ARG DRIFTTY_VERSION=dev
RUN cp /native/defaults.c ttyd-1.7.7/src/driftty-defaults.c \
    && printf '#define DRIFTTY_VERSION "%s"\n' "$DRIFTTY_VERSION" > ttyd-1.7.7/src/driftty-version.h \
    && python3 /native/configure-ttyd.py ttyd-1.7.7/src/server.c

COPY index.html /client/index.html
# ttyd needs both the compressed length and the original size for non-gzip clients.
RUN printf 'unsigned char index_html[] = {\n' > ttyd-1.7.7/src/html.h \
    && gzip -n -9 -c /client/index.html | od -An -v -tu1 \
      | awk '{ for (i = 1; i <= NF; i++) printf "%s,", $i; print ""; }' >> ttyd-1.7.7/src/html.h \
    && printf '};\nunsigned int index_html_len = sizeof(index_html);\nunsigned int index_html_size = %s;\n' \
      "$(wc -c < /client/index.html)" >> ttyd-1.7.7/src/html.h \
    && cmake -S ttyd-1.7.7 -B ttyd-build \
      -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_FIND_LIBRARY_SUFFIXES=.a \
      -DZLIB_LIBRARY=/usr/lib/libz.a -DLIBUV_LIBRARY=/usr/lib/libuv.a \
      -DOPENSSL_USE_STATIC_LIBS=TRUE \
      -DCMAKE_EXE_LINKER_FLAGS='-static -no-pie -Wl,--gc-sections' \
    && cmake --build ttyd-build --parallel 4 \
    && mkdir -p /out/native-licenses \
    && cp ttyd-build/ttyd /out/driftty-terminal \
    && strip /out/driftty-terminal \
    && test -z "$(readelf -l /out/driftty-terminal | grep INTERP)" \
    && test -z "$(readelf -d /out/driftty-terminal | grep NEEDED)" \
    && cp ttyd-1.7.7/LICENSE /out/native-licenses/ttyd.txt \
    && cp libwebsockets-4.3.5/LICENSE /out/native-licenses/libwebsockets.txt \
    && cp json-c-0.18/COPYING /out/native-licenses/json-c.txt

RUN cd /out/native-licenses \
    && curl -fsSL --retry 3 https://raw.githubusercontent.com/openssl/openssl/openssl-3.5.9/LICENSE.txt -o openssl.txt \
    && curl -fsSL --retry 3 https://raw.githubusercontent.com/libuv/libuv/v1.51.0/LICENSE -o libuv.txt \
    && curl -fsSL --retry 3 'https://git.musl-libc.org/cgit/musl/plain/COPYRIGHT?h=v1.2.5' -o musl.txt \
    && curl -fsSL --retry 3 https://raw.githubusercontent.com/madler/zlib/v1.3.2/LICENSE -o zlib.txt \
    && echo '7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a  openssl.txt' | sha256sum -c - \
    && echo '16de0c32b265cb7d46a6d3bd614f259dd4d693a5e26b3407b04aae8d73041f0c  libuv.txt' | sha256sum -c - \
    && echo 'f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af  musl.txt' | sha256sum -c - \
    && echo 'e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2  zlib.txt' | sha256sum -c -

RUN cd /out/native-licenses \
    && curl -fsSL --retry 3 https://raw.githubusercontent.com/ryanoasis/nerd-fonts/v3.4.0/patched-fonts/JetBrainsMono/Ligatures/Regular/OFL.txt -o jetbrains-mono.txt \
    && curl -fsSL --retry 3 https://raw.githubusercontent.com/ryanoasis/nerd-fonts/v3.4.0/LICENSE -o nerd-fonts.txt \
    && echo '30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad  jetbrains-mono.txt' | sha256sum -c - \
    && echo '1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160  nerd-fonts.txt' | sha256sum -c -

FROM scratch AS export
COPY --from=build /out/ /
