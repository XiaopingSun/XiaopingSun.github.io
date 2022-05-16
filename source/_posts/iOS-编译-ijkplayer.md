---
title: iOS 编译 ijkplayer
date: 2022-05-13 09:14:38
index_img: https://hexo.qiniu.pursue.show/ijkplayer.png
banner_img:
categories: 音视频开发
tags: [播放器, ijkplayer]
sticky:
---

# 前言

最近想看看 ijkplayer 的源码，学习下 ffmpeg，这篇先记录下 iOS 端编译支持 SSL 的 ijkplayer framework。

# 编译过程

首先将 ijkplayer 下载到本地：

```shell
git clone git@github.com:bilibili/ijkplayer.git
```

下载好的仓库在 k0.8.8的 Tag 上切分支：

```shell
git checkout -B develop k0.8.8
```

进入仓库目录，我们编译用到的相关脚本是截图中红框部分：

![ijkplayer 文件目录](https://hexo.qiniu.pursue.show/ijk.png)

{% note info %}

**init-ios.sh**: 将 gas-preprocessor 和 ffmpeg 下载到 extra/ 文件夹下，并将 ffmpeg 按具体架构 git clone --reference 到 ios/ 文件夹下用于编译不同的架构。

**init-ios-ssl.sh**: 将 openssl 源码下载到 extra/ 文件夹下，并将其按架构 git clone --reference 到 ios/ 文件夹下用于编译不同的架构。

**compile-ffmpeg.sh**: 脚本调用 do-compile-ffmpeg 编译不同架构的 ffmpeg，编译后 lipo create 生成 universal 版本和头文件。

**compile-openssl.sh**: 脚本调用 do-compile-openssl 编译不同架构的 openssl，编译后 lipo create 生成 universal 版本和头文件。

**do-compile-ffmpeg**: 配置编译参数，按架构编译 ffmpeg。

**do-compile-openssl**: 配置编译参数，按架构编译 openssl。

{% endnote %}

如果不需要支持 ssl 按以下顺序执行脚本即可：

```shell
./init-ios.sh
cd ios/
./compile-ffmpeg.sh
```

如果要支持 ssl，需要详细看下脚本内容，do-compile-ffmpeg 的 206 行有这样的代码：

```shell
# with openssl
if [ -f "${FFMPEG_DEP_OPENSSL_LIB}/libssl.a" ]; then
    FFMPEG_CFG_FLAGS="$FFMPEG_CFG_FLAGS --enable-openssl"

    FFMPEG_CFLAGS="$FFMPEG_CFLAGS -I${FFMPEG_DEP_OPENSSL_INC}"
    FFMPEG_DEP_LIBS="$FFMPEG_CFLAGS -L${FFMPEG_DEP_OPENSSL_LIB} -lssl -lcrypto"
fi
```

do-compile-ffmpeg 脚本会先去当前架构下 openssl 的编译目录查看是否有编译好的 libssl.a 以此作为是否需要支持 ssl 的依据，所以在调用 compile-ffmpeg.sh 脚本前需要先编译好 openssl，支持 ssl 的脚本执行顺序：

```shell
./init-ios-openssl.sh
./init-ios.sh
cd ios/
./compile-openssl.sh
./compile-ffmpeg.sh
```

这样编译的 ffmpeg 会启用 ssl，编译完成后，打开 ijkplayer 的 demo 可以看到 ijkplayer 有两个静态库的 target，IJKMediaFramework 和 IJKMediaFrameworkWithSSL：

![ijkMediaFramework](https://hexo.qiniu.pursue.show/ijkplayerframework.png)

IJKMediaFrameworkWithSSL 的库添加了 SSL 库的引用，但工程默认依赖的是 IJKMediaFramework，为了避免修改头文件，可以给 IJKMediaFramework 添加 SSL 库的引用：

![添加 ssl 引用](https://hexo.qiniu.pursue.show/addssl.png)

添加好就可以 Build 项目了。

# 一个坑

不出意外编译过程中会碰到一个 armv7 的报错类似[这样](https://github.com/bilibili/ijkplayer/issues/4494)，解决方法是在脚本里将 armv7 架构去掉：

![删除 armv7](https://hexo.qiniu.pursue.show/armv7.png)

如果项目有要求支持 armv7，可以尝试使用低版本的 xcode sdk 编译，上面的 issue 上有解决方法，但没有尝试。

# 后记

开始撸源码吧。
