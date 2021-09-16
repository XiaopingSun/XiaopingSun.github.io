---
title: Mac环境编译rtmpdump
top: true
cover: true
toc: true
mathjax: false
date: 2021-09-16 22:06:56
categories: 
  - 音视频开发
tags: 
  - rtmp
summary: 记录一下在Mac环境下编译rtmpdump的各种排坑过程
---

# 前言

最近一直在学习流媒体的 rtmp 协议，想结合 librtmp 的源码看下协议具体实现，但下载后 make 发现各种问题，而且项目里没有 configure 和 cmake，只有一个 Makefile，所以又补习了 Makefile 的常用写法，这个[Makefile教程](https://blog.csdn.net/weixin_38391755/article/details/80380786)相当不错，可以当做小手册来查。

# 踩坑开始

首先准备 github 环境，将 rtmpdump 工程 clone 到本地 <https://github.com/mstorsjo/rtmpdump>

`git clone git@github.com:mstorsjo/rtmpdump.git`

工程目录很简单，源代码文件很少，文件夹层级只有两层，librtmp 文件夹是 librtmp.a 库的源码文件，rtmpdump 根目录下是 rtmp 命令行工具的源码文件。

```bash
.
├── COPYING
├── ChangeLog
├── Makefile
├── README
├── librtmp
│   ├── COPYING
│   ├── Makefile
│   ├── amf.c
│   ├── amf.h
│   ├── bytes.h
│   ├── dh.h
│   ├── dhgroups.h
│   ├── handshake.h
│   ├── hashswf.c
│   ├── http.h
│   ├── librtmp.3
│   ├── librtmp.3.html
│   ├── librtmp.pc.in
│   ├── log.c
│   ├── log.h
│   ├── parseurl.c
│   ├── rtmp.c
│   ├── rtmp.h
│   └── rtmp_sys.h
├── rtmpdump.1
├── rtmpdump.1.html
├── rtmpdump.c
├── rtmpgw.8
├── rtmpgw.8.html
├── rtmpgw.c
├── rtmpsrv.c
├── rtmpsuck.c
├── thread.c
└── thread.h
```

文件夹首层和 librtmp 文件夹内都有一个 Makefile，这是个嵌套结构，一般只需要在根目录 make 即可，会先编译 librtmp.a 再编译命令行工具。

查看 github 的 readme.md 发现，mac 环境编译需要携带参数 SYS=darwin，然后我们开始编译：

`make SYS=darwin`

但运行后报错，无法找到openssl：

```bash
gcc -Wall   -DRTMPDUMP_VERSION=\"v2.4\" -DUSE_OPENSSL  -O2 -fPIC   -c -o rtmp.o rtmp.c
rtmp.c:60:10: fatal error: 'openssl/ssl.h' file not found
#include <openssl/ssl.h>
         ^~~~~~~~~~~~~~~
1 error generated.
make[1]: *** [rtmp.o] Error 1
make: *** [librtmp/librtmp.a] Error 2
```

查看 Makefile 发现是编译 librtmp 所需的 rtmp.c 中引用了 openssl，并且在编译时找不到链接库。openssl 是我用 brew install 安装的，并不在系统默认的目录下，而且 rtmpdump 是很久之前的代码，新版本的 openssl 会有兼容性问题，所以建议到官网下载 openssl 历史版本，这里用的是 [openssl 0.9.8x](https://www.openssl.org/source/old/0.9.x/openssl-0.9.8x.tar.gz)。

下载好 openssl 之后进入到根目录，之后配置 configure 并 make:

`./configure darwin64-x86_64-cc no-shared`

`make`

查看 librtmp 文件夹内的 Makefile 文件发现有两个变量可以在调用 make 时将 openssl 的头文件和库文件的路径索引传进来，因此 cd 回 rtmpdump 根目录重新 make，将刚刚编译好的 openssl 的路径传递进来:

`make SYS=darwin XCFLAGS='-I/Users/workspace_sun/Downloads/openssl-0.9.8x/include' XLDFLAGS='-L/Users/workspace_sun/Downloads/openssl-0.9.8x'`

这次没有再报错了，有几个 warning 不知道是否会影响使用，但 librtmp.a 已经编译出来了，rtmpdump 根目录也多了4个可执行文件：rtmpdump、rtmpgw、rtmpsrv、rtmpsuck

# 结语

至此 Mac 平台的 rtmpdump 就编译好了，虽然很过程不太顺利，但也学到了 Makefile 的一些常用语法，不过手写起来确实不是很方便，如果是我我应该会选cmake。。。
