---
title: 使用 RTMP 协议传输
date: 2022-05-12 11:10:11
index_img: https://hexo.qiniu.pursue.show/rtmp.png
banner_img:
categories: 音视频开发
tags: [RTMP]
sticky:
---

# 前言

Adobe 公司的实时消息传输协议 (RTMP) 通过一个可靠地流传输提供了一个双向多通道消息服务，意图在通信端之间传递带有时间信息的视频、音频和数据消息流。RTMP 是建立在 TCP 连接基础上的应用层协议，TCP 连接成功后需要再在应用层做一次握手，握手成功后客户端和服务端就可以开始交换消息了。

[librtmp](https://github.com/ossrs/librtmp) 是依据 RTMP 协议标准实现的开源库，使用起来比较简单。我们依赖的是某互联网厂商对 librtmp 维护的一个版本，在源库基础上做了优化并增加一些功能比如获取 ip 和建连时间、设置 callback 回调等等。开源库地址：[Github](https://github.com/pili-engineering/pili-librtmp)

# 代码实现

创建 PILI_RTMP 结构体，配置参数，建立连接：

```objc
#define RTMP_RECEIVE_TIMEOUT    2

...
  	// 初始化 PILI_RTMP
  	PILI_RTMP* rtmp = PILI_RTMP_Alloc();
    if (!rtmp) {
        return -1;
    }
    PILI_RTMP_Init(rtmp);
    
    rtmp->m_tcp_nodelay = 0;
    rtmp->m_errorCallback = RTMPErrorCallback;
    rtmp->m_userData = (__bridge void *)self;
    rtmp->Link.timeout = RTMP_RECEIVE_TIMEOUT;
    rtmp->m_connCallback = ConnectionTimeCallback;

		//设置URL
    if (PILI_RTMP_SetupURL(_rtmp, push_url, &_error) == FALSE) {
        return -1;
    }

		//设置可写，即发布流，这个函数必须在连接前使用，否则无效
    PILI_RTMP_EnableWrite(_rtmp);

    //连接服务器
    if (PILI_RTMP_Connect(_rtmp, NULL, &_error) == FALSE) {
        return -1;
    }

    //连接流
    if (PILI_RTMP_ConnectStream(_rtmp, 0, &_error) == FALSE) {
        return -1;
    }
...
```

PILI_RTMP_SetupURL 函数用来解析 URL 构造 PILI_RTMP_LNK 结构体用于网络连接，PILI_RTMP_EnableWrite 告知 librtmp 我们希望推送 RTMP 而不是播放。

PILI_RTMP_Connect 函数主要是完成 TCP 连接、RTMP 握手和发送 connect 消息：

```objc
...
  	int t1 = PILI_RTMP_GetTime();
		// tcp 连接
    if (!PILI_RTMP_Connect0(r, cur_ai, port, error)) {
        freeaddrinfo(ai);
        return FALSE;
    }
    conn_time.connect_time = PILI_RTMP_GetTime() - t1;
    r->m_bSendCounter = TRUE;

    int t2 = PILI_RTMP_GetTime();
		// rtmp 握手、发送 connect 消息
    int ret = PILI_RTMP_Connect1(r, cp, error);
    conn_time.handshake_time = PILI_RTMP_GetTime() - t2;

    if (r->m_connCallback != NULL) {
        r->m_connCallback(&conn_time, r->m_userData);
    }
...
```

连接 wireshark 抓包看下这个函数产生的数据包交互：

![wireshark-connect](https://hexo.qiniu.pursue.show/wireshark-rtmp.png)

Protocol 为 RTMP 的消息是 wireshark 帮忙解析出的应用层数据，可以看到客户端和服务端 TCP 握手成功后，客户端发送了 C0+C1 的握手消息，服务端收到后返回 S0+S1+S2，客户端收到后返回 C2 完成握手。随后客户端发送 connect 消息连接到应用 “pursue-online”，服务端发送窗口大小、对端带宽大小和 Chunk 大小的消息给客户端用来初始化网络出口和数据大小，其实这个服务端的包里还有一个消息是对客户端的 connect 的消息回复的 result，wireshark 没有显示出来。由于客户端断点没有做后续处理，服务端超过超时时间断开了 TCP 连接。

PILI_RTMP_ConnectStream 函数会循环读取从服务端收到的数据包（就是解析上图中蓝色背景的这条从服务端过来的数据）：

```objc
...
    while (!r->m_bPlaying && PILI_RTMP_IsConnected(r) && PILI_RTMP_ReadPacket(r, &packet)) {
            if (RTMPPacket_IsReady(&packet)) {
                if (!packet.m_nBodySize)
                    continue;
                if ((packet.m_packetType == RTMP_PACKET_TYPE_AUDIO) ||
                    (packet.m_packetType == RTMP_PACKET_TYPE_VIDEO) ||
                    (packet.m_packetType == RTMP_PACKET_TYPE_INFO)) {
                    PILI_RTMP_Log(PILI_RTMP_LOGWARNING, "Received FLV packet before play()! Ignoring.");
                    PILI_RTMPPacket_Free(&packet);
                    continue;
                }

                PILI_RTMP_ClientPacket(r, &packet);
                PILI_RTMPPacket_Free(&packet);
            }
        }
...
```

解析得到的消息有 4 个，分别是 0x05 设置窗口大小、0x06 设置带宽大小、0x01 设置 chunk 大小 以及 0x14 用来回复 connect 命令的 result，在收到 0x05、0x06、0x01 时 librtmp 更新了本地的配置，当收到 0x14 这条 connect 的 result 时，客户端确定成功链接到 App，于是发送 releaseStream 命令让服务端先将该流释放，然后发送 FCPublish 和 createStream 命令在 App 中创建流，收到服务端 createStream 的 result 后，客户端发送 publish 命令表明开始推流，服务端收到后返回 onStatus，客户端解析 OK 后将 isPlaying 标志位设置为 YES，表示可以开始推流音视频数据：

![wireshark-connect](https://hexo.qiniu.pursue.show/wireshark-connect.png)

接着是发送音视频数据包，librtmp 将数据单元抽象成 RTMPPacket 的结构体，需要使用 Tag Header 的属性参数和 Tag Body 的数据指针构建出 RTMPPacket，然后通过 RTMP_SendPacket 函数发送出去：

```objc
...
		PILI_RTMPPacket packet;
    PILI_RTMPPacket_Reset(&packet);
    PILI_RTMPPacket_Alloc(&packet, data_size);

		if (FLV_TAG_TYPE_VIDEO == tag_type) {
        pkt->m_packetType = tag_type; // video 0x09
        pkt->m_nBodySize = data_size; // body size
        pkt->m_nTimeStamp = timestamp;
        pkt->m_nChannel = 0x06;
        pkt->m_headerType = RTMP_PACKET_SIZE_LARGE;
        pkt->m_nInfoField2 = m_stream_id;
        pkt->m_hasAbsTimestamp = 0;
        
        memcpy(pkt->m_body, data, data_size);
    } else if (FLV_TAG_TYPE_AUDIO == tag_type) {
        pkt->m_packetType = tag_type; // audio 0x08
        pkt->m_nBodySize = data_size; // body size
        pkt->m_nTimeStamp = timestamp;
        pkt->m_nChannel = 0x04;
        pkt->m_headerType = RTMP_PACKET_SIZE_LARGE;
        pkt->m_nInfoField2 = m_stream_id;
        pkt->m_hasAbsTimestamp = 0;
        
        memcpy(pkt->m_body, data, data_size);
    } else if (FLV_TAG_TYPE_SCRIPT == tag_type) {
        pkt->m_packetType = tag_type; // script 0x12
        pkt->m_nBodySize = data_size; // body size
        pkt->m_nTimeStamp = timestamp;
        pkt->m_nChannel = 0x04;
        pkt->m_nInfoField2 = m_stream_id;
        pkt->m_hasAbsTimestamp = 0;
        
        memcpy(pkt->m_body, data, data_size);
    }

		RTMPError error = {0};
    if (!PILI_RTMP_SendPacket(rtmp, &packet, 0, &error)) {
        PILI_RTMPPacket_Free(&packet);
        return -1;
    }
    
    PILI_RTMPPacket_Free(&packet);		
...
```

wireshark 抓包可以看到，第一个包负载的是 metadata，也就是 FLV 的 script tag，之后交替的是 audio 和 video tag：

![wireshark-stream](https://hexo.qiniu.pursue.show/wireshark-stream.png)

使用完别忘了关闭连接释放资源：

```objc
...
  	PILI_RTMP_Close(rtmp, NULL);
    PILI_RTMP_Free(rtmp);
    rtmp = NULL;
...
```

# 后记

这篇主要是介绍下 iOS 平台 RTMP 协议推流的功能实现，没有涉及太多的协议内容，RTMP 协议内容还是比较多的，需要大量的时间去研究和实践，文末会贴一些官方翻译文档和工具库。

至此，推流的整个流程就都完成了，从采集、渲染、编码、封装再到传输都有了一个大致的了解，每个模块都学到了很多东西，对我自己来说是一个很大的提升了，而这些也仅仅是音视频开发最基础的部分。作为一个商用的音视频 SDK 还要考虑如何将这些模块合理编排，如何封装接口兼容每一项配置，并通过大批量的用户接入打磨框架和接口。有了一个稳定框架的基础，就可以做一些有意思的事情，比如图像和声音的处理，抗弱网的策略，协议层面的优化等等，音视频技术深不见底也望不到边，需要学习的还很多，加油骚年！

# 参考文档

>RTMP 协议规范（中文版） https://www.cnblogs.com/Kingfans/p/7083100.html
>
>带你吃透 RTMP https://www.jianshu.com/p/b2144f9bbe28
>
>手撕 RTMP 协议细节 https://cloud.tencent.com/developer/article/1630596?from=article.detail.1633286
>
>librtmp https://github.com/ossrs/librtmp
>
>pili-librtmp https://github.com/pili-engineering/pili-librtmp
>
>LFLiveKit（iOS 开源推流 SDK）https://github.com/LaiFengiOS

