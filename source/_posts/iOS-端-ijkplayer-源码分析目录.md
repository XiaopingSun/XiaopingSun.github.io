---
title: iOS 端 ijkplayer 源码分析目录
date: 2022-05-30 13:59:52
index_img: https://hexo.qiniu.pursue.top/ijkplayer.png
banner_img:
categories: 音视频开发
tags: ijkplayer
sticky:
---

# 前言

ijkplayer 是 B 站开发的一款业界公认比较优秀的播放器框架，项目是开源的，所以也给音视频开发者提供了很好的学习资料。最近花了大概两周的时间整体看了一遍源码，学到了很多东西，也有些没有弄清楚的点，所以想借着写博客的机会分块再将 ijkplayer 的流程捋一遍，让自己这半个月的源码学习更有价值。

# 播放器流程

这里先贴一个雷神博客上的播放器流程图：

![播放器流程图-雷霄骅](https://hexo.qiniu.pursue.top/20140201120523046.jpeg)

一般在看播放器源码之前，需要先了解播放器的工作流程，将各阶段拆分开来阅读源码，思路会清晰一些。

每个阶段的具体分工，雷神的博客上有详细的讲解可以参考：https://blog.csdn.net/leixiaohua1020/article/details/18893769

# ijkplayer 整体框架

iOS 端 ijkplayer 的上层框架如图：

![ijkplayer 上层框架](https://hexo.qiniu.pursue.top/ijkplayer%E6%A1%86%E6%9E%B6/%E6%9C%AA%E5%91%BD%E5%90%8D%E6%96%87%E4%BB%B6%20%282%29.png)

可以看到 ijkplayer 包含三种不同类型的播放器，为了方便 App 层接入使用，它们遵循同一套接口协议 IJKMediaPlayback，但底层框架和接口实现是不同的。IJKAVMoviePlayerController 基于 AVPlayer，IJKMPMoviePlayerController 基于更老一些的 MediaPlayer，它们都基于系统框架，底层的功能实现是看不到的，一般只要会使用就 OK。区别于前两者，IJKFFMoviePlayerController 基于 FFMPEG，准确地说 ijkplayer 是在 ffplay.c 的基础上做了 c 代码层的改造，虽然 FFMPEG 接口帮助完成了解协议、解封装和解码的操作，但仍需我们将整个流程串联起来，为每个阶段提供必要的缓存和操作线程控制，解码后的音视频数据的同步处理，音视频的渲染（ijkplayer 自己实现的一套 SDL），以及对顶层接口的适配等等，整个流程还是比较复杂的，所以会看到 ijkplayer 源码中定义了大量的成员变量，大部分都是没有注释的，需要结合代码一点点去理解它们代表的含义，这些也正是需要学习的东西。

ijkplayer（之后统一指 IJKFFMoviePlayerController）的整体流程图可以简化为：

![转载自 http://yydcdut.com/2019/07/06/ijkplayer-video-audio-sync/](https://hexo.qiniu.pursue.top/ijkplayer%E6%A1%86%E6%9E%B6/ijkplayer%E6%B5%81%E7%A8%8B.png)

上面提到过看播放器的源码最好是将功能拆分来看，可以看到最左侧的 stream_open 是整个流程的开始，调用 stream_open 之前主要是初始化相关的代码。stream_open 函数创建了两个线程，读取流数据线程（执行函数为 read_thread）和视频渲染线程（执行函数为 video_refresh）。read_thread 函数会先解析流信息，创建解码线程，并开始尝试从流中获取解码前的数据，将其发送的 Packet Queue。创建的解码线程基于数据流中 stream 的个数，音频解码线程执行函数为 audio_thread，视频解码线程执行函数为 video_thread，字幕解码线程执行函数为 subtitle_thread（图中没有画出来）。解码线程会不停像 Packet Queue 要解码前的数据，将其送到解码器解码，同时解码线程也会轮询解码器看是否有解码完成的原始数据帧，如果有就将它送进 Frame Queue。之后就是渲染线程不停地问 Frame Queue 要数据，这里有一个疑问，read_thread 中创建了视频渲染线程，但没有创建音频的，这是因为在 iOS 端音频输出使用的是 Audio Queue 或者更底层的 Audio Unit，系统框架会在 AU 的 remote_io 线程回调函数问上层去要数据，所以就不用额外创建了。渲染线程拿到各自想要的数据后，还需要做音视频同步，同步的方式有很多种，ijkplayer 默认使用的是视频向音频同步，因为对于画面来说，人类对于音频的不连续会更敏感一些。同步完成后就可以将数据提交给硬件去渲染了，iOS 平台音频使用 Audio Queue 来渲染，视频则将数据生成纹理，使用 OpenGL 渲染。

可以看到上图中其实就包含了 ijkplayer 的大部分工作流程，流程图非常清晰，后续的博客也会基于这张图的流程对源码做一个纵向的分析，同时也会总结一些这张图上没有的功能点，比如 seek 功能的实现，消息机制的设计和字幕流的处理，帮助更好的熟悉和理解源码。

# 源码分析目录

iOS 端 ijkplayer 源码分析 - 数据流的读取和解封装

iOS 端 ijkplayer 源码分析 - 视频流的解码

iOS 端 ijkplayer 源码分析 - 音频流的解码

iOS 端 ijkplayer 源码分析 - 字幕流的解码

iOS 端 ijkplayer 源码分析 - 视频流的渲染

iOS 端 ijkplayer 源码分析 - 音频流的渲染

iOS 端 ijkplayer 源码分析 - 字幕流的渲染

iOS 端 ijkplayer 源码分析 - 音视频同步

iOS 端 ijkplayer 源码分析 - seek 的实现

iOS 端 ijkplayer 源码分析 - 消息机制

# 后记

