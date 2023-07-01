---
title: SRWebSocket源码分析记录
date: 2022-04-03 11:21:07
index_img: https://hexo.qiniu.pursue.top/websocket.png
categories: 网络协议
tags: [webSocket, 网络协议]
---

# 前言

今天是 2022 年 4 月 3 日，博客搭建完成后已经大半年没有记录过了，上次是去年 9 月份，接着 10 月初转岗到 SDK 部门，到今年 3 月底离职，刚好半年时间。这半年好像忙的也没有什么时间静下来写写博客，借着疫情居家这段时间，重新搭了下博客页面，打算好好记录一下，学到的技术和日常生活。说到 webSocket，其实背景是七牛的实时音视频 SDK 使用了 SRWebSocket 与服务端交互信令，由于业务需求需要给 SRWebSocket 添加一些功能，比如 DNS 预解析、重连策略、webSocket 各阶段打点，所以就详细读了 SRWebSocket 源码，了解了 webSocket 协议。

# webSocket 协议简介

webSocket 诞生前，如果要在客户端和服务端之间实现双向通信，通常的做法是客户端 HTTP 轮询服务端接口，这样不仅效率低，会消耗大量流量，而且也不能保证服务端消息第一时间传递给客户端，算不上是真正意义的双向通信，而这也是 webSocket 出现的原因。webSocket 协议被设计来取代现有 HTTP 轮询方式实现双向通信，它和 HTTP 的区别在于，webSocket 不再遵循客户端主动发起请求，服务端回复响应的 Request-Response 机制，而是可以在客户端没有发送请求的情况下，服务端也可以主动发送数据给客户端，仅使用一个 TCP 连接就实现真正意义的双向通讯。同时，webSocket 将消息打包成一个个帧序列，与冗长的 HTTP 请求体相比消耗更少的流量。

![http 轮询和 websocket 对比](https://hexo.qiniu.pursue.top/websocket-http.webp)

webSocket 和 HTTP 一样属于应用层协议，协议 scheme 是  `ws://` 和 `wss://` ，默认端口是 80 和 443，其交互过程包含以下阶段：

建立 TCP 连接、SSL 握手（如果有）、webSocket 握手、发送数据帧和关闭连接。

## 建立 TCP 连接

上面提到 webSocket 只使用了一个 TCP 连接，那首先是要与服务端建立这个 TCP 连接。

![TCP 连接](https://hexo.qiniu.pursue.top/tcp-connect.png)

## SSL 握手（如果有）

如果协议头是 `wss://`，默认会在建立 TCP 连接后，webSocket 握手前，获取服务端证书并校验，SSL 握手完成后后续请求会使用协商后的加密算法。SRWebSocket 源码支持未授信证书和自签证书的导入验证。

![SSL 握手](https://hexo.qiniu.pursue.top/ssl-handshake)

## webSocket 握手

webSocket 握手实际是一个 HTTP Upgrade 请求，使用 HTTP 的原因与 webSocket 默认端口设置为 80 或 443 是一样的，为了确保兼容性，80 和 443 是 HTTP 和 HTTPS 使用的端口，服务器一般都会开放，不至于被防火墙挡掉，而使用 HTTP 也好理解，就是使用一个大家通用的协议去协商一个不太通用的协议，方便协商过程中字段属性的传递，也便于解析协商结果。

### 来自客户端的握手请求

```
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Origin: http://example.com
Sec-WebSocket-Protocol: chat, superchat
Sec-WebSocket-Version: 13
```

- **GET /chat HTTP/1.1**

握手使用的 HTTP 版本至少是 1.1，请求方式是 GET，这里的 Path 可能需要解释下，一般客户端传入的 webSocket 地址可能会是 `ws://aaa.bbb.ccc/path`，实际用来建立 TCP 连接只需要 host 解析出的 IP 和根据协议名选取的默认端口号，`/path` 一般表示握手服务所在路径。

- **Host: server.example.com**

握手服务域名。

- **Upgrade: websocket**

Upgrade 是 HTTP 协议中用于定义转换协议的 Header 域，它表示如果服务器支持的话，客户端希望从已建立好的连接协议，切换到另外一个应用层协议，这里是希望将协议切换成 webSocket。

- **Connection: Upgrade**

需要将 Connection 设置为 Upgrade，指示该请求用于协议升级。

- **Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==**

Sec-WebSocket-Key 是客户端在请求前生成 16 位随机字符经过 Base64 编码后生成的24位字符，服务端收到后会对该字符串做处理后，通过头部字段 Sec-WebSocket-Accept 返回给客户端。

- **Origin: http://example.com**

用于标识原始域名，防止跨域攻击。

- **Sec-WebSocket-Protocol: chat, superchat**

客户端支持的子协议列表，服务端需从数组中选择支持的协议并返回，如果都不支持，会导致握手失败。客户端也可不发送子协议，但一旦发送，需两端一致才能成功握手。

- **Sec-WebSocket-Version**

客户端支持的协议版本，如果该版本没有匹配服务端理解的任何一个版本，需要握手失败。

![handshake 请求](https://hexo.qiniu.pursue.top/handshake-req.png)

### 来自服务端的握手返回

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

- **HTTP/1.1 101 Switching Protocols**

服务端返回 101 表示收到并同意将协议切换到 webSocket。

- **Upgrade: websocket**

与客户端请求头一致。

- **Connection: Upgrade**

与客户端请求头一致。

- **Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=**

服务端在收到客户端的 Sec-WebSocket-Key 之后，将 Sec-WebSocket-Key 拼接协议规定的字符串 `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` 后，做一次 Sha-1 散列，接着 Base64 编码，得到的字符串作为 Sec-WebSocket-Accept 返回给客户端，而客户端要做的是将之前请求使用的 Sec-WebSocket-Key 按照服务端的流程做字符串处理后，与 Sec-WebSocket-Accept 比对，如果不匹配，需要握手失败。

![handshake 返回](https://hexo.qiniu.pursue.top/handshake-resp.png)

## 数据帧

协议规定的 webSocket 帧组成部分：

```
  0                   1                   2                   3
  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 +-+-+-+-+-------+-+-------------+-------------------------------+
 |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
 |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
 |N|V|V|V|       |S|             |   (if payload len==126/127)   |
 | |1|2|3|       |K|             |                               |
 +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
 |     Extended payload length continued, if payload len == 127  |
 + - - - - - - - - - - - - - - - +-------------------------------+
 |                               |Masking-key, if MASK set to 1  |
 +-------------------------------+-------------------------------+
 | Masking-key (continued)       |          Payload Data         |
 +-------------------------------- - - - - - - - - - - - - - - - +
 :                     Payload Data continued ...                :
 + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
 |                     Payload Data continued ...                |
 +---------------------------------------------------------------+
```

webSocket 的消息类型大致分为两种：数据类型和控制类型，数据类型的消息由于长度取决于消息内容本身，所以较长的数据消息会采取分帧策略，将一个数据消息拆分成若干个上述格式的数据帧，而控制类型的消息一般内容比较少，单帧就可以负载所有内容，不需要分帧。有些文档上解释成帧和片，为了避免混淆，本篇将指令单元用“消息”表示，发送单元用“帧”表示。下面看下帧内容：

- FIN

1 bit，用于指使此帧是否是消息的最后片段，如果消息没有分帧，FIN 一定是 1。SRWebSocket 在解析消息的时候会使用 FIN 判断消息的结束。

- RSV1、RSV2、RSV3

每个 1 bit，必须是 0，除非一个扩展协议将非0值定义含义。如果收到一个非 0 值且没有协商的扩展协议定义这个非 0 值的含义，接收端必须将 webSocket 连接视为失败。

- opcode

4 bit，定义了该帧负载数据的类型，字段值和消息类型的对应关系如下：

```
%x0 代表一个继续帧
%x1 代表一个文本帧
%x2 代表一个二进制帧
%x3-7 保留用于未来的非控制帧
%x8 代表连接关闭
%x9 代表ping
%xA 代表pong
%xB-F 保留用于未来的控制帧	
```

- MASK

1 bit，定义了此帧负载数据是否是经过掩码的。如果设置为 1，会有 4 字节的 Masking-key 出现在 Payload 数据前面，如上图。客户端收到 MASK 为 1 的帧，需要解析 Masking-key 并按位对 Payload 做异或运算拿到掩码前的真实数据。另外协议规定从客户端发送到服务器的所有帧需要将 MASK 设置为 1，使用掩码。

- Payload len

7 bit，定义了负载数据的长度，如果是 0 - 125，表示是真实的负载数据长度。如果是 126，之后的2字节（Extended payload length）是用来表示负载长度的 16 位无符号整数。如果是 127，之后的 8 字节（Extended payload length）是用来表示负载长度的 64 位无符号整数。这里遵循用最小字节数表示负载长度的原则。

- Extended payload length

16 bit / 64 bit，如上所述，该字段是用在 Payload len 的 7 bit 不足以表示负载长度时，所占字节数依赖 Payload len 的值。

- Masking-key

32 bit，当 MASK 为 1 时，该字段存在，MASK 为 0 时，该字段缺失。

- Payload Data

负载数据。

### 看个例子

![websocket 抓包](https://hexo.qiniu.pursue.top/websocket-wire.png)

这是一条服务端给客户端发送的 webSocket 消息，首先看它的 Opcode 是 1 并且 Fin 是 1，说明这条数据消息没有使用分帧策略。Mask 为 0 说明没有使用掩码，字段里也就没有 Masking key。Payload length 是 126，说明在 Payload length 之后有 2 字节的 Extended Payload Length 用来标识负载的真实长度。Extended Payload Length 标识负载长度是 277，我们用这个长度去解析 Payload。由于这条数据消息只有一个数据帧，因此我们解析完成后可以将消息直接回调给上层。

## 关闭连接

webSocket 的关闭并不只是简单的一端主动断开 TCP 连接，需要考虑本端和对端缓存里是否有未及时处理的数据，需要区分具体的情况，详细的可以参考官方文档：[关于如何关闭连接](https://chenjianlong.gitbooks.io/rfc-6455-websocket-protocol-in-chinese/content/section7/section7.html)

# SRWebSocket 源码分析记录

{% note info %}

[SRWebSocket](https://github.com/facebookincubator/SocketRocket) 是 Facebook 提供的根据 webSocket 协议标准实现的 iOS 平台库，之前七牛 RTC 项目使用的是 0.5.1 版本，比较稳定，本篇也针对这一版本的代码做下基础分析。

{% endnote %}

## 外层调用

源码只有一个类 SRWebSocket，头文件里定义了一系列属性、初始化方法和回调，可以按需配置，我们引入这个头文件，使用姿势也很简单：

```objc
- (void)viewDidLoad {
    [super viewDidLoad];
    // Do any additional setup after loading the view.
        
    NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"ws://%@:%@", server, port]]];
    _webSocket = [[SRWebSocket alloc] initWithURLRequest:request];
    _webSocket.delegate = self;
}

- (IBAction)open:(UIButton *)sender {
    [_webSocket open];
}

- (IBAction)close:(UIButton *)sender {
    [_webSocket close];
}

#pragma mark - SRWebSocketDelegate
- (void)webSocket:(SRWebSocket *)webSocket didReceiveMessage:(id)message {
    NSLog(@"SRWebSocket didReceiveMessage: %@", message);
}

- (void)webSocketDidOpen:(SRWebSocket *)webSocket{
    NSLog(@"SRWebSocket webSocketDidOpen");
}

- (void)webSocket:(SRWebSocket *)webSocket didFailWithError:(NSError *)error {
    NSLog(@"SRWebSocket didFailWithError: %@", error);
}

- (void)webSocket:(SRWebSocket *)webSocket didCloseWithCode:(NSInteger)code reason:(NSString *)reason wasClean:(BOOL)wasClean {
    NSLog(@"SRWebSocket didCloseWithCode: %ld  reason: %@", code, reason);
}
```

接下来我们看下源码内部。

## 初始化

```objc
- (id)initWithURLRequest:(NSURLRequest *)request protocols:(NSArray *)protocols allowsUntrustedSSLCertificates:(BOOL)allowsUntrustedSSLCertificates;
{
    self = [super init];
    if (self) {
        assert(request.URL);
        _url = request.URL;
        _urlRequest = request;
        _allowsUntrustedSSLCertificates = allowsUntrustedSSLCertificates;
        
        _requestedProtocols = [protocols copy];
        
        [self _SR_commonInit];
    }
    
    return self;
}
```

Init 方法初始化一些属性变量，url 保存 webSocket 地址，requestedProtocols 保存客户端定义的子协议，allowsUntrustedSSLCertificates 标识是否允许未授信的证书，如果设置为 YES，会在连接中忽略证书链的校验。接下来调用了 SR_commonInit 方法做进一步初始化。

```objc
- (void)_SR_commonInit;
{
  	// 如果协议不是 ws、http、wss、https，assert
    NSString *scheme = _url.scheme.lowercaseString;
    assert([scheme isEqualToString:@"ws"] || [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"wss"] || [scheme isEqualToString:@"https"]);
    
  	// 判断是否是安全连接
    if ([scheme isEqualToString:@"wss"] || [scheme isEqualToString:@"https"]) {
        _secure = YES;
    }
    
  	// 更新状态 - 连接中
    _readyState = SR_CONNECTING;
  
  	// 消费者是否都已停止   该字段未使用
    _consumerStopped = YES;
  
  	// 标识客户端使用的 webSocket 版本
    _webSocketVersion = 13;
    
  	// 初始化读写控制队列  串行
    _workQueue = dispatch_queue_create(NULL, DISPATCH_QUEUE_SERIAL);
    
    // Going to set a specific on the queue so we can validate we're on the work queue
    dispatch_queue_set_specific(_workQueue, (__bridge void *)self, maybe_bridge(_workQueue), NULL);
    
  	// 获取回调队列  主线程
    _delegateDispatchQueue = dispatch_get_main_queue();
    sr_dispatch_retain(_delegateDispatchQueue);
    
  	// 初始化读写缓存
    _readBuffer = [[NSMutableData alloc] init];
    _outputBuffer = [[NSMutableData alloc] init];
    
  	// 初始化当前 opcode 下的 payload 缓存  一般只存放文本帧和二进制帧的 payload  拼接成完整消息后回调出去
    _currentFrameData = [[NSMutableData alloc] init];

  	// 初始化消费者工作队列
    _consumers = [[NSMutableArray alloc] init];
    
  	// 初始化消费者缓存池
    _consumerPool = [[SRIOConsumerPool alloc] init];
    
  	// 初始化 runloop 缓存池
    _scheduledRunloops = [[NSMutableSet alloc] init];
    
    [self _initializeStreams];
    
    // default handlers
}
```

SR_commonInit 方法里首先是校验了 Url 的协议是否是预期，判断是否是安全连接，初始化一些队列和线程，接着调用 initializeStreams 初始化输入输出的 stream。

```objc
- (void)_initializeStreams;
{
  	// 判断端口号是否超过 32 位 unsigned int 大小
    assert(_url.port.unsignedIntValue <= UINT32_MAX);
    uint32_t port = _url.port.unsignedIntValue;
  
  	// 如果端口没传，通过之前判断的 _secure 字段设置端口 80 或 443
    if (port == 0) {
        if (!_secure) {
            port = 80;
        } else {
            port = 443;
        }
    }
    NSString *host = _url.host;
    
    CFReadStreamRef readStream = NULL;
    CFWriteStreamRef writeStream = NULL;
    
  	// 通过 host 和 port 创建输入输出流
    CFStreamCreatePairWithSocketToHost(NULL, (__bridge CFStringRef)host, port, &readStream, &writeStream);
    
  	// 将 CFReadStreamRef、CFWriteStreamRef 转成 oc 的 NSInputStream 和 NSOutputStream，释放所有权
    _outputStream = CFBridgingRelease(writeStream);
    _inputStream = CFBridgingRelease(readStream);
    
  	// 设置输入输出流的代理
    _inputStream.delegate = self;
    _outputStream.delegate = self;
}
```

initializeStreams 方法先是做了端口号校验，如果 Url 没传端口号，那么默认使用 80 或 443 端口，接着通过域名和端口号创建输入输出流，将 CoreFoundation 指针转成 OC 的对象，设置代理，输入输出流的事件会回调 handleEvent 方法。

## 建立 TCP 连接、SSL 握手（如果有）

```objc
- (void)open;
{
    assert(_url);
  
  	// 防止在 connecting 状态下多次 open
    NSAssert(_readyState == SR_CONNECTING, @"Cannot call -(void)open on SRWebSocket more than once");

  	// retain self 防止被释放造成野指针异常
    _selfRetain = self;

  	// 如果 _urlRequest 设置了超时时间，sr 内部是用 GCD 的 after 去计算超时时间，如果超过了 _urlRequest.timeoutInterval 之后 self.readyState 依然是 未连接成功 就会主动断开
    if (_urlRequest.timeoutInterval > 0)
    {
        dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, _urlRequest.timeoutInterval * NSEC_PER_SEC);
        dispatch_after(popTime, dispatch_get_main_queue(), ^(void){
            if (self.readyState == SR_CONNECTING)
                [self _failWithError:[NSError errorWithDomain:@"com.squareup.SocketRocket" code:504 userInfo:@{NSLocalizedDescriptionKey: @"Timeout Connecting to Server"}]];
        });
    }

    [self openConnection];
}
```

上面的初始化方法完成后，外层就可以主动调用 open 打开连接了。可以看到 open 方法里使用 GCD 对超时时间做控制，如果需要定义超时时间，需要在初始化时的 NSURLRequest 对象里设置 timeoutInterval。open 方法最后调用 openConnection 去打开连接。

```objc
- (void)openConnection;
{
  	// 给输入输出流配置安全设置和网络类型
    [self _updateSecureStreamOptions];
    
  	// 给输入输出流绑定 runloop
    if (!_scheduledRunloops.count) {
        [self scheduleInRunLoop:[NSRunLoop SR_networkRunLoop] forMode:NSDefaultRunLoopMode];
    }
    
    // 打开输入输出流   这里会与服务端做 tcp 连接  完成会回调 handleEvent 方法 NSStreamEventOpenCompleted 事件
    [_outputStream open];
    [_inputStream open];
}
```

openConnection 方法先是调用 updateSecureStreamOptions 给输入输出流配置 SSL 和选取网络服务类型，接着给输入输出流绑定一个全局 runloop，最后打开输入输出流，与服务端建立 TCP 连接。

```objc
- (void)_updateSecureStreamOptions;
{
  	// 如果 scheme 是 wss:// 需要给输出流配置 kCFStreamPropertySSLSettings
    if (_secure) {
        NSMutableDictionary *SSLOptions = [[NSMutableDictionary alloc] init];
        
      	// 设置 ssl 安全级别
     		//  Indicates to use TLS or SSL with fallback to lower versions. This is what HTTPS does, for instance. 
        [_outputStream setProperty:(__bridge id)kCFStreamSocketSecurityLevelNegotiatedSSL forKey:(__bridge id)kCFStreamPropertySocketSecurityLevel];
        
      	// 如果是自签证书 不验证证书链
        // If we're using pinned certs, don't validate the certificate chain
        if ([_urlRequest SR_SSLPinnedCertificates].count) {
            [SSLOptions setValue:@NO forKey:(__bridge id)kCFStreamSSLValidatesCertificateChain];
        }
        
#if DEBUG
        self.allowsUntrustedSSLCertificates = YES;
#endif

      	// 如果设置允许使用未授信的证书 不验证证书链
        if (self.allowsUntrustedSSLCertificates) {
            [SSLOptions setValue:@NO forKey:(__bridge id)kCFStreamSSLValidatesCertificateChain];
            SRFastLog(@"Allowing connection to any root cert");
        }
        
        [_outputStream setProperty:SSLOptions
                            forKey:(__bridge id)kCFStreamPropertySSLSettings];
    }
    
    _inputStream.delegate = self;
    _outputStream.delegate = self;
    
  	// 输入输出流设置网络服务类型
    [self setupNetworkServiceType:_urlRequest.networkServiceType];
}
```

updateSecureStreamOptions 主要是针对 SSL 的一些处理，如果 Url 的 scheme 是  `wss://` ，需要给输出流做 SSL 的相关配置，如果在初始化时传了自签证书或者设置了允许未授信证书，将不验证证书链，方法最后调用 setupNetworkServiceType 设置输入输出流的网络类型。

```objc
- (void)scheduleInRunLoop:(NSRunLoop *)aRunLoop forMode:(NSString *)mode;
{
    [_outputStream scheduleInRunLoop:aRunLoop forMode:mode];
    [_inputStream scheduleInRunLoop:aRunLoop forMode:mode];
    
    [_scheduledRunloops addobjc:@[aRunLoop, mode]];
}
```

scheduleInRunLoop 方法给输入输出流设置了 runloop 和 runloop mode，最后将 runloop 和 runloop mode 加入到缓存队列，我们看下这个 runloop 是哪里来的：

```objc
static _SRRunLoopThread *networkThread = nil;
static NSRunLoop *networkRunLoop = nil;

@implementation NSRunLoop (SRWebSocket)

+ (NSRunLoop *)SR_networkRunLoop {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        networkThread = [[_SRRunLoopThread alloc] init];
        networkThread.name = @"com.squareup.SocketRocket.NetworkThread";
        [networkThread start];
        networkRunLoop = networkThread.runLoop;
    });
    
    return networkRunLoop;
}
```

在这个 NSRunLoop 的分类里定义了一个 networkThread 单例的初始化方法，单例携带一个 networkRunLoop，所以拿到的是一个常驻线程的 runloop，用于处理输入输出流的回调。

到此，SRWebSocket 源码使用的三个线程队列都已初始化完成，他们分别是：

- **networkThread**：用于处理输入输出流并回调
- **workQueue**：SR 的主要工作队列，用于处理连接、输入输出流的读取等操作
- **delegateOperationQueue**：用于处理上层的回调

输入输出流打开后，会与服务端尝试 TCP 连接并进行 SSL 握手，完成后会回调 handleEvent 方法：

```objc
- (void)stream:(NSStream *)aStream handleEvent:(NSStreamEvent)eventCode;
{
    __weak typeof(self) weakSelf = self;
    
  	// 这里处理自签证书的验证
    if (_secure && !_pinnedCertFound && (eventCode == NSStreamEventHasBytesAvailable || eventCode == NSStreamEventHasSpaceAvailable)) {
        
        NSArray *sslCerts = [_urlRequest SR_SSLPinnedCertificates];
        if (sslCerts) {
            SecTrustRef secTrust = (__bridge SecTrustRef)[aStream propertyForKey:(__bridge id)kCFStreamPropertySSLPeerTrust];
            if (secTrust) {
                NSInteger numCerts = SecTrustGetCertificateCount(secTrust);
                for (NSInteger i = 0; i < numCerts && !_pinnedCertFound; i++) {
                    SecCertificateRef cert = SecTrustGetCertificateAtIndex(secTrust, i);
                    NSData *certData = CFBridgingRelease(SecCertificateCopyData(cert));
                    
                    for (id ref in sslCerts) {
                        SecCertificateRef trustedCert = (__bridge SecCertificateRef)ref;
                        NSData *trustedCertData = CFBridgingRelease(SecCertificateCopyData(trustedCert));
                        
                        if ([trustedCertData isEqualToData:certData]) {
                          	// 如果服务端证书与本地自签证书匹配
                            _pinnedCertFound = YES;
                            break;
                        }
                    }
                }
            }
            
          	// 如果没有发现匹配的证书，需要将错误回调上层
            if (!_pinnedCertFound) {
                dispatch_async(_workQueue, ^{
                    NSDictionary *userInfo = @{ NSLocalizedDescriptionKey : @"Invalid server cert" };
                    [weakSelf _failWithError:[NSError errorWithDomain:@"org.lolrus.SocketRocket" code:23556 userInfo:userInfo]];
                });
                return;
            } else if (aStream == _outputStream) {
                dispatch_async(_workQueue, ^{
                   	// 继续走握手流程
                    [self didConnect];
                });
            }
        }
    }

  	// 处理 event
    dispatch_async(_workQueue, ^{
        [weakSelf safeHandleEvent:eventCode stream:aStream];
    });
}
```

```objc
- (void)safeHandleEvent:(NSStreamEvent)eventCode stream:(NSStream *)aStream
{
        switch (eventCode) {
            // 连接成功
            case NSStreamEventOpenCompleted: {
                SRFastLog(@"NSStreamEventOpenCompleted %@", aStream);
                if (self.readyState >= SR_CLOSING) {
                    return;
                }
                assert(_readBuffer);
                
              	// 除自签证书外的其他情况  会走到这里的 didConnect 方法进行握手
                // didConnect fires after certificate verification if we're using pinned certificates.
                BOOL usingPinnedCerts = [[_urlRequest SR_SSLPinnedCertificates] count] > 0;
                if ((!_secure || !usingPinnedCerts) && self.readyState == SR_CONNECTING && aStream == _inputStream) {
                    [self didConnect];
                }
...
```

handleEvent 方法里的代码是对自签证书的验证，在两端 TCP 连接完成后，将服务端证书与传入的自签证书一一比对，如果发现匹配就继续下一步的握手操作，如果没有匹配，则验证失败回调上层。实际 event 事件的处理是在 safeHandleEvent 里，在监听到 NSStreamEventOpenCompleted 事件后，除自签证书这种情况外，都会走到这里的握手方法。

## webSocket握手

```objc
- (void)didConnect;
{
    SRFastLog(@"Connected");
  	// 创建 HTTP 的 GET 请求，版本 HTTP 1.1
    CFHTTPMessageRef request = CFHTTPMessageCreateRequest(NULL, CFSTR("GET"), (__bridge CFURLRef)_url, kCFHTTPVersion1_1);
    
    // Set host first so it defaults
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Host"), (__bridge CFStringRef)(_url.port ? [NSString stringWithFormat:@"%@:%@", _url.host, _url.port] : _url.host));
        
  	// 初始化 16 位随机字符
    NSMutableData *keyBytes = [[NSMutableData alloc] initWithLength:16];
    SecRandomCopyBytes(kSecRandomDefault, keyBytes.length, keyBytes.mutableBytes);
    
  	// Base64 编码   生成的 _secKey 用于请求头中的 Sec-WebSocket-Key
    if ([keyBytes respondsToSelector:@selector(base64EncodedStringWithOptions:)]) {
        _secKey = [keyBytes base64EncodedStringWithOptions:0];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        _secKey = [keyBytes base64Encoding];
#pragma clang diagnostic pop
    }
    
  	// 校验编码后是否为 24 位
    assert([_secKey length] == 24);

    // Apply cookies if any have been provided
    NSDictionary * cookies = [NSHTTPCookie requestHeaderFieldsWithCookies:[self requestCookies]];
    for (NSString * cookieKey in cookies) {
        NSString * cookieValue = [cookies objcForKey:cookieKey];
        if ([cookieKey length] && [cookieValue length]) {
            CFHTTPMessageSetHeaderFieldValue(request, (__bridge CFStringRef)cookieKey, (__bridge CFStringRef)cookieValue);
        }
    }
 
    // set header for http basic auth
    if (_url.user.length && _url.password.length) {
        NSData *userAndPassword = [[NSString stringWithFormat:@"%@:%@", _url.user, _url.password] dataUsingEncoding:NSUTF8StringEncoding];
        NSString *userAndPasswordBase64Encoded;
        if ([keyBytes respondsToSelector:@selector(base64EncodedStringWithOptions:)]) {
            userAndPasswordBase64Encoded = [userAndPassword base64EncodedStringWithOptions:0];
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            userAndPasswordBase64Encoded = [userAndPassword base64Encoding];
#pragma clang diagnostic pop
        }
        _basicAuthorizationString = [NSString stringWithFormat:@"Basic %@", userAndPasswordBase64Encoded];
        CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Authorization"), (__bridge CFStringRef)_basicAuthorizationString);
    }
	
  	// 这里设置的是 webSocket 握手请求的头部信息
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Upgrade"), CFSTR("websocket"));
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Connection"), CFSTR("Upgrade"));
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Sec-WebSocket-Key"), (__bridge CFStringRef)_secKey);
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Sec-WebSocket-Version"), (__bridge CFStringRef)[NSString stringWithFormat:@"%ld", (long)_webSocketVersion]);
    
    CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Origin"), (__bridge CFStringRef)_url.SR_origin);
    
    if (_requestedProtocols) {
        CFHTTPMessageSetHeaderFieldValue(request, CFSTR("Sec-WebSocket-Protocol"), (__bridge CFStringRef)[_requestedProtocols componentsJoinedByString:@", "]);
    }

    [_urlRequest.allHTTPHeaderFields enumerateKeysAndobjcsUsingBlock:^(id key, id obj, BOOL *stop) {
        CFHTTPMessageSetHeaderFieldValue(request, (__bridge CFStringRef)key, (__bridge CFStringRef)obj);
    }];
    
  	// 将 HTTP 请求报文转成 OC 的 NSData 对象
    NSData *message = CFBridgingRelease(CFHTTPMessageCopySerializedMessage(request));
    
    CFRelease(request);

  	// 将 HTTP 请求报文写入到输出缓存
    [self _writeData:message];
  
  	// 读取 HTTP 返回头部信息
    [self _readHTTPHeader];
}
```

didConnect 方法创建一个 HTTP 请求的 MessageRef，按照之前介绍过的 webSocket 握手标准，设置请求的头部信息，Sec-WebSocket-Key 是先生成 16 位随机字符再 Base64 编码成 24 位字符，将外部传入的子协议写入 Sec-WebSocket-Protocol 字符。方法的最后获取到 HTTP 请求报文的 NSData 对象，调用 writeData 将数据写入到输出缓冲区，等待输出流有空间可写时，将数据发送给服务端。最后调用 readHTTPHeader 创建 HTTP header 的消费者尝试从输入缓冲区中读取返回头信息。

```objc
- (void)_readHTTPHeader;
{
    if (_receivedHTTPHeaders == NULL) {
        _receivedHTTPHeaders = CFHTTPMessageCreateEmpty(NULL, NO);
    }
                        
  	// 尝试读取 HTTP Response Header
    [self _readUntilHeaderCompleteWithCallback:^(SRWebSocket *self,  NSData *data) {
        CFHTTPMessageAppendBytes(_receivedHTTPHeaders, (const UInt8 *)data.bytes, data.length);
        // 判断 Header 是否有效
        if (CFHTTPMessageIsHeaderComplete(_receivedHTTPHeaders)) {
            SRFastLog(@"Finished reading headers %@", CFBridgingRelease(CFHTTPMessageCopyAllHeaderFields(_receivedHTTPHeaders)));
          	// 继续 Header 校验
            [self _HTTPHeadersDidFinish];
        } else {
          	// 重复读取
            [self _readHTTPHeader];
        }
    }];
}
```

readHTTPHeader 方法中调用 readUntilHeaderCompleteWithCallback ，其方法内部实际是创建一个消费者去缓存中读取匹配 Header 特征字符的数据段，读到数据后回调 Block。回调函数中对 Header 是否有效做了校验，如果无效，重复读取 Header，有效则继续后续的 Header 校验。

```objc
- (void)_HTTPHeadersDidFinish;
{
  	// 获取 HTTP Code
    NSInteger responseCode = CFHTTPMessageGetResponseStatusCode(_receivedHTTPHeaders);
    
  	// 校验 Code
    if (responseCode >= 400) {
        SRFastLog(@"Request failed with response code %d", responseCode);
        [self _failWithError:[NSError errorWithDomain:SRWebSocketErrorDomain code:2132 userInfo:@{NSLocalizedDescriptionKey:[NSString stringWithFormat:@"received bad response code from server %ld", (long)responseCode], SRHTTPResponseErrorKey:@(responseCode)}]];
        return;
    }
    
    // 校验 Sec-WebSocket-Accept
    if(![self _checkHandshake:_receivedHTTPHeaders]) {
        [self _failWithError:[NSError errorWithDomain:SRWebSocketErrorDomain code:2133 userInfo:[NSDictionary dictionaryWithobjc:[NSString stringWithFormat:@"Invalid Sec-WebSocket-Accept response"] forKey:NSLocalizedDescriptionKey]]];
        return;
    }
    
  	// 校验 Sec-WebSocket-Protocol
    NSString *negotiatedProtocol = CFBridgingRelease(CFHTTPMessageCopyHeaderFieldValue(_receivedHTTPHeaders, CFSTR("Sec-WebSocket-Protocol")));
    if (negotiatedProtocol) {
        // Make sure we requested the protocol
        if ([_requestedProtocols indexOfobjc:negotiatedProtocol] == NSNotFound) {
            [self _failWithError:[NSError errorWithDomain:SRWebSocketErrorDomain code:2133 userInfo:[NSDictionary dictionaryWithobjc:[NSString stringWithFormat:@"Server specified Sec-WebSocket-Protocol that wasn't requested"] forKey:NSLocalizedDescriptionKey]]];
            return;
        }
        
        _protocol = negotiatedProtocol;
    }
    
  	// 更新状态 - 已连接
    self.readyState = SR_OPEN;
    
  	// 这个标志位没有用到，所以一定会走 readFrameNew，尝试读取 webSocket 数据帧
    if (!_didFail) {
        [self _readFrameNew];
    }

  	// 将已连接状态回调给上层
    [self _performDelegateBlock:^{
        if ([self.delegate respondsToSelector:@selector(webSocketDidOpen:)]) {
            [self.delegate webSocketDidOpen:self];
        };
    }];
}
```

```objc
- (BOOL)_checkHandshake:(CFHTTPMessageRef)httpMessage;
{
  	// 拿到服务端返回的 Sec-WebSocket-Accept
    NSString *acceptHeader = CFBridgingRelease(CFHTTPMessageCopyHeaderFieldValue(httpMessage, CFSTR("Sec-WebSocket-Accept")));

    if (acceptHeader == nil) {
        return NO;
    }
    
  	// 将本地的 _secKey 拼接协议规定的字符串
    NSString *concattedString = [_secKey stringByAppendingString:SRWebSocketAppendToSecKeyString];
  	// 先做 Sha-1 散列，后 Base64 编码
    NSString *expectedAccept = [concattedString stringBySHA1ThenBase64Encoding];
    
  	// 将处理后的结果与 Sec-WebSocket-Accept 比对，返回比对结果
    return [acceptHeader isEqualToString:expectedAccept];
}
```

可以看到 SRWebSocket 在校验握手返回头部信息时分了三个步骤，一是校验 HTTP Response Code 是否大于 400，其实协议规定的是服务端要返回 101，SRWebSocket 这里处理的比较宽松。二是校验 Sec-WebSocket-Accept，方法是将 Sec-WebSocket-Key 按服务端的方式，拼接协议规定字符串，sha-1 散列后 Base64 编码，如果结果与 Sec-WebSocket-Accept 一致，校验通过。三是校验 Sec-WebSocket-Protocol，如果服务端返回的这个字段有值，说明客户端在请求时提供了子协议方案，所以需要比对客户端和服务端的子协议是否一致。这三项校验完成，说明握手已经成功，此时更新状态为已连接，并回调给上层。

## 数据读取与写入

首先看一下 SRWebSocket 读取和写入的流程：

![SRWebSocket 流程图](https://hexo.qiniu.pursue.top/SRWebSockey%E6%B5%81%E7%A8%8B%E5%9B%BE.png)

黄色区域部分是 SRWebSocket 的处理流程，可以看到，在输入输出流和客户端之间有一个读写缓存区作为输入输出数据的缓冲，相比数据写入，数据读取会复杂一些。

### 数据读取

NSInputStream 从服务端的 Output 通道接收数据后，回调 NSStreamEventHasBytesAvailable 事件给 SRWebSocket：

```objc
- (void)safeHandleEvent:(NSStreamEvent)eventCode stream:(NSStream *)aStream
{
        switch (eventCode) {
...
            case NSStreamEventHasBytesAvailable: {
                // 输入流中有数据可读
                SRFastLog(@"NSStreamEventHasBytesAvailable %@", aStream);
                const int bufferSize = 2048;
                uint8_t buffer[bufferSize];
                
                // 将输入流中的数据读到已读缓存区
                while (_inputStream.hasBytesAvailable) {
                    NSInteger bytes_read = [_inputStream read:buffer maxLength:bufferSize];
                    
                    if (bytes_read > 0) {
                        [_readBuffer appendBytes:buffer length:bytes_read];
                    } else if (bytes_read < 0) {
                        [self failWithError:_inputStream.streamError];
                    }
                    
                    if (bytes_read != bufferSize) {
                        break;
                    }
                };
                
                // 尝试从已读缓冲区读取数据
                [self _pumpScanner];
                break;
            }
...
```

在收到 NSStreamEventHasBytesAvailable 事件后，SRWebSocket 将输入流中可读的数据读到已读缓存区 _readBuffer 中，接下来要做的是从 _readBuffer 解析出 webSocket 消息给到客户端，需要借助 SRWebSocket 设计的消费者。

输入输出流被成功打开后，我们能从输入流中读到的数据分为两种，一个是握手阶段的 HTTP Response Header，另一个是 webSocket 帧数据。如果要从一个二进制流中解析这两种数据需要如何做呢，对于 HTTP Response Header 可以在缓存区中查找 `\r\n\r\n` 将匹配的最后一个字符之前的数据取出来就是所有的 HTTP Header 数据（因为握手总是发生在 webSocket 帧发送之前）。至于为什么是 `\r\n\r\n` 可以看下服务端返回的 HTTP 报文：

```
HTTP/1.1 200 Ok\r\n
Server: AAA\r\n
Cache-Control: no-cache\r\n
Date: Fri, 07 Nov 2014 23:20:27 GMT\r\n
Content-Type: text/html\r\n
Connection: close\r\n\r\n   <--------------
```

每个 HTTP Header 之后一般都会有 `\r\n` 用于换行，而 Header 和 Body 之间会空一行，所以 Header 的末尾会是 `\r\n\r\n` 。解析出握手的返回头信息后，就是解析 webSocket 帧数据了，通过观察帧的结构发现每一帧所占字节数是不固定的，而且没有类似 HTTP Header 的分隔符作为标志，所以只能分批次解析 webSocket 帧。首先读取 2 个字节的数据，解析 Payload Length 和 Mask，通过这两个值判断是否有 Extension Payload Length 和 Masking Key，如果有，再把这部分数据读出来，此时已经拿到 Payload 数据长度，再往后就是 Payload 数据了，按 Payload Length 去读就可以。

SRWebSocket 消费者就是按这种模式去设计的，分为 HTTP consumer 和 webSocket consumer，每当有数据需要从已读缓存区读取时，就会创建对应的 consumer 加入到消费者工作队列 consumers 中，同时读取事件循环会从 consumers 中取出 consumer 去缓存区匹配数据。为了防止 consumer 创建过多，SRWebSocket 维护了一个消费者缓存池 consumerPool，需要时从缓存池获取，使用完成后归还缓存池，缓存池的大小默认是 8。

首先来看一下 HTTP consumer 的初始化代码：

```objc
- (void)_readHTTPHeader;
{
...       
    [self _readUntilHeaderCompleteWithCallback:^(SRWebSocket *self,  NSData *data) {
        ...
    }];
}

// HTTP Header 匹配字符
static const char CRLFCRLFBytes[] = {'\r', '\n', '\r', '\n'};

- (void)_readUntilHeaderCompleteWithCallback:(data_callback)dataHandler;
{
    [self _readUntilBytes:CRLFCRLFBytes length:sizeof(CRLFCRLFBytes) callback:dataHandler];
}

- (void)_readUntilBytes:(const void *)bytes length:(size_t)length callback:(data_callback)dataHandler;
{
    // TODO optimize so this can continue from where we last searched
  	// 定义了一个匿名函数，在 data 中查找匹配字符，并返回最后一个匹配字符前的字节数量
    stream_scanner consumer = ^size_t(NSData *data) {
        __block size_t found_size = 0;
        __block size_t match_count = 0;
        
        size_t size = data.length;
        const unsigned char *buffer = data.bytes;
        for (size_t i = 0; i < size; i++ ) {
            if (((const unsigned char *)buffer)[i] == ((const unsigned char *)bytes)[match_count]) {
                match_count += 1;
                if (match_count == length) {
                  	// 所有字符匹配完成
                    found_size = i + 1;
                    break;
                }
            } else {
              	// 发现有不匹配，重置索引
                match_count = 0;
            }
        }
        return found_size;
    };
  	// 使用匹配规则的匿名函数 和匹配完成回调函数创建消费者
    [self _addConsumerWithScanner:consumer callback:dataHandler];
}

// 俄罗斯套娃...
- (void)_addConsumerWithScanner:(stream_scanner)consumer callback:(data_callback)callback;
{
    [self assertOnWorkQueue];
    [self _addConsumerWithScanner:consumer callback:callback dataLength:0];
}

// 最后一层...
- (void)_addConsumerWithScanner:(stream_scanner)consumer callback:(data_callback)callback dataLength:(size_t)dataLength;
{    
    [self assertOnWorkQueue];
  	// 从消费者缓存池中取出消费者，加入到工作队列
    [_consumers addobjc:[_consumerPool consumerWithScanner:consumer handler:callback bytesNeeded:dataLength readToCurrentFrame:NO unmaskBytes:NO]];
...
}
```

可以看到 SRWebSocket 把 HTTP Header 的匹配设计成消费者的一个匿名函数，这个匿名函数将对缓存区里的数据进行匹配拿到 Data 和 Size，之后将数据回调给 Callback 函数做 Header 的校验。

接着来看一下 webSocket consumer 的初始化代码：

```objc
- (void)_addConsumerWithDataLength:(size_t)dataLength callback:(data_callback)callback readToCurrentFrame:(BOOL)readToCurrentFrame unmaskBytes:(BOOL)unmaskBytes;
{   
    [self assertOnWorkQueue];
    assert(dataLength);
    
  	// 从消费者缓存池中取出消费者，加入到工作队列
    [_consumers addobjc:[_consumerPool consumerWithScanner:nil handler:callback bytesNeeded:dataLength readToCurrentFrame:readToCurrentFrame unmaskBytes:unmaskBytes]];
...
}
```

代码看起来跟创建 HTTP consumer 最后一步差不多，只是初始化 consumer 时传参不同。HTTP consumer 只需要一个匹配规则和处理回调，其他参数不关心。而 webSocket consumer 不需要匹配规则，需要的是按字节数读取数据，所以需要传入 dataLength。readToCurrentFrame 用于标识这个 consumer 是否处理的是数据类型消息的数据帧，unmaskBytes 用于标识 Payload 是否需要解掩码，这两个字段只有在 consumer 解析 Payload 数据时有用，其他情况传 NO。

初始化方法介绍完了，接下来分析下 webSocket consumer 的使用：

```objc
- (void)_readFrameNew;
{
    dispatch_async(_workQueue, ^{
      	// 清空当前消息数据缓存区
        [_currentFrameData setLength:0];
        
      	// 当前消息的类型
        _currentFrameOpcode = 0;
      
      	// 当前消息包含的帧数
        _currentFrameCount = 0;
      
      	// 参数未用到
        _readOpCount = 0;
      
      	// 用来记录 _currentFrameData 中已校验 UTF-8 编码的字符串位置偏移
        _currentStringScanPosition = 0;
        
      	// 继续
        [self _readFrameContinue];
    });
}
```

readFrameNew 是创建 webSocket 消费者的入口，方法中将几个比较重要的参数清空，currentFrameData、currentFrameOpcode、currentFrameCount 和 currentStringScanPosition 都只是给数据类型消息使用的，控制类型消息没有使用。currentFrameOpcode 这里可能有个疑问，为什么初始化为 0，0 在 opcode 中不是代表延续帧吗。其实 SRWebSocket 在读取前两个字节解析 opcode 时，如果 opcode 是 0，在构造 frame_header 结构体时依旧会沿用这个消息起始帧的 opcode 值，所以这里设置为 0 不会有冲突。

接着是 readFrameContinue 方法：

```objc
- (void)_readFrameContinue;
{
  	// 猜测这里的控制主要是校验代码逻辑
    assert((_currentFrameCount == 0 && _currentFrameOpcode == 0) || (_currentFrameCount > 0 && _currentFrameOpcode > 0));

  	// 创建一个读取 2 个字节数据的 webSocket 消费者到工作队列
    [self _addConsumerWithDataLength:2 callback:^(SRWebSocket *self, NSData *data) {
      // 构造一个 webSocket 头信息的结构体
      __block frame_header header = {0};
        
        const uint8_t *headerBuffer = data.bytes;
        assert(data.length >= 2);
        
      	// 拿到 RSV1、RSV2、RSV3，根据协议规定这三位必须是 0
        if (headerBuffer[0] & SRRsvMask) {
            [self _closeWithProtocolError:@"Server used RSV bits"];
            return;
        }
        
      	// 拿到 opcode
        uint8_t receivedOpcode = (SROpCodeMask & headerBuffer[0]);
        
      	// 控制帧 = ping 或 pong 或 close  数据帧 = !控制帧
        BOOL isControlFrame = (receivedOpcode == SROpCodePing || receivedOpcode == SROpCodePong || receivedOpcode == SROpCodeConnectionClose);
        
      	// currentFrameCount > 0 说明在等待 opcode 为 0 的延续帧
        if (!isControlFrame && receivedOpcode != 0 && self->_currentFrameCount > 0) {
            [self _closeWithProtocolError:@"all data frames after the initial data frame must have opcode 0"];
            return;
        }
        
      	// currentFrameCount = 0 说明一定不要是延续帧
        if (receivedOpcode == 0 && self->_currentFrameCount == 0) {
            [self _closeWithProtocolError:@"cannot continue a message"];
            return;
        }
        
      	// 这里就是前文提到的 如果当前帧 opcode 是 0，在构造 frame_header 时将 opcode 设置成当前消息首帧的 opcode 值
        header.opcode = receivedOpcode == 0 ? self->_currentFrameOpcode : receivedOpcode;
        
      	// 获取 FIN
        header.fin = !!(SRFinMask & headerBuffer[0]);
        
        // 获取 Mask
        header.masked = !!(SRMaskMask & headerBuffer[1]);
      
      	// 获取 Payload Length
        header.payload_length = SRPayloadLenMask & headerBuffer[1];
        
        headerBuffer = NULL;
      
      	// 如果当前帧 Mask 位的值为 1，SRWebSocket 直接将连接关闭了，但实际协议只是规定客户端发送消息需要使用掩码，并没有对服务端行为做约束，这里是有些差异的
        if (header.masked) {
            [self _closeWithProtocolError:@"Client must receive unmasked data"];
        }
        
      	// extra_bytes_needed 是用来统计 Extension Payload Length 和 Masking Key 的长度，用于下一轮 consumer 的消费
      	// 如果 Mask 位为 1，要加上 4 位的 Masking Key 长度。
        size_t extra_bytes_needed = header.masked ? sizeof(_currentReadMaskKey) : 0;
        
        if (header.payload_length == 126) {
          	// 如果 Payload Length 是 126，要加上 16 位的 Extension Payload Length
            extra_bytes_needed += sizeof(uint16_t);
        } else if (header.payload_length == 127) {
          	// 如果 Payload Length 是 127，要加上 64 位的 Extension Payload Length
            extra_bytes_needed += sizeof(uint64_t);
        }
        
        if (extra_bytes_needed == 0) {
          	// 如果 extra_bytes_needed 为 0，说明没有 Extension Payload Length 和 Masking Key 要处理，所以直接处理 Payload
            [self _handleFrameHeader:header curData:self->_currentFrameData];
        } else {
          	// 如果 extra_bytes_needed 不为 0，创建所需数据长度为 extra_bytes_needed 的 webSocket 消费者到工作队列
            [self _addConsumerWithDataLength:extra_bytes_needed callback:^(SRWebSocket *self, NSData *data) {
                size_t mapped_size = data.length;
                #pragma unused (mapped_size)
                const void *mapped_buffer = data.bytes;
              
              	// offset 用来标记 Masking Key 的位置
                size_t offset = 0;
                
                if (header.payload_length == 126) {
                  	// 如果 Payload Length 是 126，真实负载数据长度是 Payload Length 之后的 16 位来标识
                    assert(mapped_size >= sizeof(uint16_t));
                    uint16_t newLen = EndianU16_BtoN(*(uint16_t *)(mapped_buffer));
                    header.payload_length = newLen;
                    offset += sizeof(uint16_t);
                } else if (header.payload_length == 127) {
                  	// 如果 Payload Length 是 127，真实负载数据长度是 Payload Length 之后的 64 位来标识
                    assert(mapped_size >= sizeof(uint64_t));
                    header.payload_length = EndianU64_BtoN(*(uint64_t *)(mapped_buffer));
                    offset += sizeof(uint64_t);
                } else {
                  	// 能走到这里，说明没有 Extension Payload Length
                    assert(header.payload_length < 126 && header.payload_length >= 0);
                }
                
              	// 如果 Mask 位为 1，需要将 Masking Key 读取到缓存区，用于之后 Payload 解掩码
                if (header.masked) {
                    assert(mapped_size >= sizeof(_currentReadMaskOffset) + offset);
                    memcpy(self->_currentReadMaskKey, ((uint8_t *)mapped_buffer) + offset, sizeof(self->_currentReadMaskKey));
                }
                
              	// 处理 Payload
                [self _handleFrameHeader:header curData:self->_currentFrameData];
            } readToCurrentFrame:NO unmaskBytes:NO];
        }
    } readToCurrentFrame:NO unmaskBytes:NO];
}
```

readFrameContinue 方法先是创建了一个读取 2 个字节数据的 consumer，读取到数据后构建一个 frame_header 结构体，通过对 Mask 位和 Payload Length 的解析，判断是否有 Extension Payload Length 和 Masking Key 存在，如果存在，就创建一个读取这部分数据的 consumer，获取到真实负载长度和掩码后，创建读取 Payload 数据的 consumer，如果不存在则直接创建一个读取 Payload 数据的 consumer。

```objc
- (void)_handleFrameHeader:(frame_header)frame_header curData:(NSData *)curData;
{
  	// 前面介绍过，构造的 frame_header 的 opcode 不应该为 0
    assert(frame_header.opcode != 0);
    
    if (self.readyState == SR_CLOSED) {
        return;
    }
    
    // 控制帧 = ping 或 pong 或 close  数据帧 = !控制帧
    BOOL isControlFrame = (frame_header.opcode == SROpCodePing || frame_header.opcode == SROpCodePong || frame_header.opcode == SROpCodeConnectionClose);
    
  	// 控制帧不能分片
    if (isControlFrame && !frame_header.fin) {
        [self _closeWithProtocolError:@"Fragmented control frames not allowed"];
        return;
    }
    
  	// 控制帧 Payload Length 不能是 126、127
    if (isControlFrame && frame_header.payload_length >= 126) {
        [self _closeWithProtocolError:@"Control frames cannot have payloads larger than 126 bytes"];
        return;
    }
    
  	// 数据帧类型才会更新这两个变量的值
    if (!isControlFrame) {
        _currentFrameOpcode = frame_header.opcode;
        _currentFrameCount += 1;
    }
    
    if (frame_header.payload_length == 0) {
      	// Payload Length 是 0
        if (isControlFrame) {
          	// 如果是控制帧，感觉这里可以将 curData 替换成 nil
            [self _handleFrameWithData:curData opCode:frame_header.opcode];
        } else {
          	// 如果是数据帧
            if (frame_header.fin) {
              	// FIN 位为 1，是当前消息的最后一帧，因此需要将 currentFrameData 缓存的当前消息的所有帧数据回调给上层
                [self _handleFrameWithData:_currentFrameData opCode:frame_header.opcode];
            } else {
                // TODO add assert that opcode is not a control;
              	// 如果是延续帧，Payload Length 为 0，直接读取下一帧
                [self _readFrameContinue];
            }
        }
    } else {
      	// Payload Length 不是 0
        assert(frame_header.payload_length <= SIZE_T_MAX);
      	// 创建读取 Payload 的 webSocket 消费者加入到工作队列
        [self _addConsumerWithDataLength:(size_t)frame_header.payload_length callback:^(SRWebSocket *self, NSData *newData) {
            if (isControlFrame) {
              	// 如果是控制帧，将这部分读到的 Payload 数据回调给上层
                [self _handleFrameWithData:newData opCode:frame_header.opcode];
            } else {
              	// 如果是数据帧
                if (frame_header.fin) {
                  	// FIN 位为 1，是当前消息的最后一帧，因此需要将 currentFrameData 缓存的当前消息的所有帧数据回调给上层
                    [self _handleFrameWithData:self->_currentFrameData opCode:frame_header.opcode];
                } else {
                    // TODO add assert that opcode is not a control;
                  	// 如果是延续帧，直接读取下一帧
                  	// 这里无需关心延续帧的 Payload 没有被 append 到 currentFrameData，在循环消费者队列匹配数据时已经处理过了
                    [self _readFrameContinue];
                }
                
            }
        } readToCurrentFrame:!isControlFrame unmaskBytes:frame_header.masked];
    }
}
```

handleFrameHeader 方法对 Payload Length 是否为 0，当前帧是控制帧还是数据帧做了逻辑区分。区别于之前创建的 webSocket 消费者，用于读取 Payload 数据的消费者 readToCurrentFrame 和 unmaskBytes 都传了值，这两个值在循环消费者队列读取数据时会用到。接下来就是处理完整的 webSocket 消息数据了：

```objc
- (void)_handleFrameWithData:(NSData *)frameData opCode:(NSInteger)opcode;
{                
    // Check that the current data is valid UTF8
    // 控制帧 = ping 或 pong 或 close  数据帧 = !控制帧
    BOOL isControlFrame = (opcode == SROpCodePing || opcode == SROpCodePong || opcode == SROpCodeConnectionClose);
  	// 到目前为止，当前消息的所有数据已经拿到了，就可以创建下一轮消费者了
    if (!isControlFrame) {
      	// 如果当前是数据帧，需要先清空数据帧相关的变量和缓存
        [self _readFrameNew];
    } else {
      	// 如果是控制帧，直接创建下一轮消费者
        dispatch_async(_workQueue, ^{
            [self _readFrameContinue];
        });
    }
    
    //frameData will be copied before passing to handlers
    //otherwise there can be misbehaviours when value at the pointer is changed
    switch (opcode) {
        case SROpCodeTextFrame: {
          	// 处理字符数据类型消息
            if ([self.delegate respondsToSelector:@selector(webSocketShouldConvertTextFrameToString:)] && ![self.delegate webSocketShouldConvertTextFrameToString:self]) {
              	// 如果上层指定字符数据使用二进制方式返回
                [self _handleMessage:[frameData copy]];
            } else {
              	// 默认字符数据使用字符串方式返回
                NSString *str = [[NSString alloc] initWithData:frameData encoding:NSUTF8StringEncoding];
                if (str == nil && frameData) {
                    [self closeWithCode:SRStatusCodeInvalidUTF8 reason:@"Text frames must be valid UTF-8"];
                    dispatch_async(_workQueue, ^{
                        [self closeConnection];
                    });
                    return;
                }
                [self _handleMessage:str];
            }
            break;
        }
        case SROpCodeBinaryFrame:
        		// 处理二进制数据类型消息
            [self _handleMessage:[frameData copy]];
            break;
        case SROpCodeConnectionClose:
        		// 处理关闭控制类型消息
            [self handleCloseWithData:[frameData copy]];
            break;
        case SROpCodePing:
        		// 处理 ping 控制类型消息
            [self handlePing:[frameData copy]];
            break;
        case SROpCodePong:
        		// 处理 pong 控制类型消息
            [self handlePong:[frameData copy]];
            break;
        default:
        		// 其他 opcode 无效
            [self _closeWithProtocolError:[NSString stringWithFormat:@"Unknown opcode %ld", (long)opcode]];
            // TODO: Handle invalid opcode
            break;
    }
}
```

handleFrameWithData 方法根据 opcode 的不同，对数据有不同的处理方式，并在处理前先创建了下一轮的消费者。以上这些代码只是 webSocket 消费者的创建和回调处理，我们还需要一个事件去驱动数据流转，这个事件就是 pumpScanner。

```objc
-(void)_pumpScanner;
{
    [self assertOnWorkQueue];
    
  	// 如果正在 pumping 直接返回
    if (!_isPumping) {
        _isPumping = YES;
    } else {
        return;
    }
    
    while ([self _innerPumpScanner]) {
        
    }
    
    _isPumping = NO;
}
```

pumpScanner 方法里循环调用了 innerPumpScanner，我们先记住这个 while 循环。

```objc
// Returns true if did work
- (BOOL)_innerPumpScanner {
    
  	// 这是个标志位  决定 pumpScanner 的循环是否持续
    BOOL didWork = NO;
    
  	// 状态不对  返回 NO
    if (self.readyState >= SR_CLOSED) {
        return didWork;
    }
    
  	// 消费者工作队列是空的   返回 NO
    if (!_consumers.count) {
        return didWork;
    }
    
  	// 已读缓冲区没有新增可读数据  返回 NO
    size_t curSize = _readBuffer.length - _readBufferOffset;
    if (!curSize) {
        return didWork;
    }
    
  	// 从消费者工作队列里取出第一个消费者
    SRIOConsumer *consumer = [_consumers objcAtIndex:0];
    
    size_t bytesNeeded = consumer.bytesNeeded;
    
    size_t foundSize = 0;
    if (consumer.consumer) {
      	// 如果消费者携带匹配规则的匿名函数，说明是 HTTP Header consumer，
        NSData *tempView = [NSData dataWithBytesNoCopy:(char *)_readBuffer.bytes + _readBufferOffset length:_readBuffer.length - _readBufferOffset freeWhenDone:NO];  
      	// 计算可读缓存中匹配 HTTP Header 的数据长度
        foundSize = consumer.consumer(tempView);
    } else {
      	// webSocket consumer
        assert(consumer.bytesNeeded);
        if (curSize >= bytesNeeded) {
          	// 可读的数据比需要的大，那么只读消费者需要的长度
            foundSize = bytesNeeded;
        } else if (consumer.readToCurrentFrame) {
          	// 可读的数据比需要的小，但这个消费者是读取数据类型的 Payload，那么能读多少读多少
            foundSize = curSize;
        }
    }
    
    NSData *slice = nil;
    if (consumer.readToCurrentFrame || foundSize) {
      	// 将消费者需要的数据取出来
        NSRange sliceRange = NSMakeRange(_readBufferOffset, foundSize);
        slice = [_readBuffer subdataWithRange:sliceRange];
        
      	// 更新偏移量
        _readBufferOffset += foundSize;
        
      	// 这里是优化缓存使用大小
        if (_readBufferOffset > 4096 && _readBufferOffset > (_readBuffer.length >> 1)) {
            _readBuffer = [[NSMutableData alloc] initWithBytes:(char *)_readBuffer.bytes + _readBufferOffset length:_readBuffer.length - _readBufferOffset];            _readBufferOffset = 0;
        }
        
      	// 消费者的 unmaskBytes 属性，如果是 1，需要将 Payload 数据解掩码，而解掩码所需的 Masking Key，之前已经保存到 currentReadMaskKey 里了
        if (consumer.unmaskBytes) {
            NSMutableData *mutableSlice = [slice mutableCopy];
            
            NSUInteger len = mutableSlice.length;
            uint8_t *bytes = mutableSlice.mutableBytes;
            
            for (NSUInteger i = 0; i < len; i++) {
                bytes[i] = bytes[i] ^ _currentReadMaskKey[_currentReadMaskOffset % sizeof(_currentReadMaskKey)];
                _currentReadMaskOffset += 1;
            }
            
            slice = mutableSlice;
        }
        
      	// 消费者的 readToCurrentFrame 属性，如果是 1，说明是在读取数据帧的 Payload
        if (consumer.readToCurrentFrame) {
          	// 将当前帧的 Payload 数据拼接到当前消息数据的缓存上
            [_currentFrameData appendData:slice];
            
          	// 参数没用上
            _readOpCount += 1;
            
          	// 如果当前帧类型是文本帧，需要对 Payload 数据做 UTF8 编码校验
            if (_currentFrameOpcode == SROpCodeTextFrame) {
                // Validate UTF8 stuff.
                size_t currentDataSize = _currentFrameData.length;
                if (_currentFrameOpcode == SROpCodeTextFrame && currentDataSize > 0) {
                    // TODO: Optimize the crap out of this.  Don't really have to copy all the data each time
                    
                    size_t scanSize = currentDataSize - _currentStringScanPosition;
                    
                    NSData *scan_data = [_currentFrameData subdataWithRange:NSMakeRange(_currentStringScanPosition, scanSize)];
                    int32_t valid_utf8_size = validate_dispatch_data_partial_string(scan_data);
                    
                    if (valid_utf8_size == -1) {
                        [self closeWithCode:SRStatusCodeInvalidUTF8 reason:@"Text frames must be valid UTF-8"];
                        dispatch_async(_workQueue, ^{
                            [self closeConnection];
                        });
                        return didWork;
                    } else {
                      	// 更新已校验字符偏移
                        _currentStringScanPosition += valid_utf8_size;
                    }
                } 
                
            }
            
          	// 更新消费者的 bytesNeeded
            consumer.bytesNeeded -= foundSize;
            
          	// 如果 bytesNeeded 是 0，说明当前消费者杀青了，调用消费者的完成回调，把它还给缓存池
            if (consumer.bytesNeeded == 0) {
                [_consumers removeobjcAtIndex:0];
                consumer.handler(self, nil);
                [_consumerPool returnConsumer:consumer];
                didWork = YES;
            }
        } else if (foundSize) {
          	// 如果不是消费者不是读取数据帧 Payload 类型的 webSocket consumer
          	// 并且已经拿到了想要的数据，调用消费者的完成回调，把它还给缓存池
            [_consumers removeobjcAtIndex:0];
            consumer.handler(self, slice);
            [_consumerPool returnConsumer:consumer];
            didWork = YES;
        }
    }
    return didWork;
}
```

这个方法里的 didWork 标志位需要跟上一个方法的 while 循环结合起来看，只有在消费者拿到了自己想要的数据完成使命后，才会将这个标志位设为 YES，进入下一次循环，因为此时可能可读缓存区还有一部分数据是可以读的。当前状态问题、工作队列没有消费者、可读缓存区没有数据可读 和消费者没有完整拿到数据，这些情况即使再跑一次 innerPumpScanner 也未必解决，不如停止循环，等待下一次 pumpScanner 的触发。

### 数据写入

与读取相比，写入是一个反向组装的过程，代码相对比较简单。写入的驱动源于客户端调用 send()、sendPing()，之后会走到 sendFrameWithOpcode 方法。

```objc
- (void)_sendFrameWithOpcode:(SROpCode)opcode data:(id)data;
{
    [self assertOnWorkQueue];
    
    if (nil == data) {
        return;
    }
    
  	// 只支持字符和二进制类型
    NSAssert([data isKindOfClass:[NSData class]] || [data isKindOfClass:[NSString class]], @"NSString or NSData");
    
  	// 计算 Payload Length
    size_t payloadLength = [data isKindOfClass:[NSString class]] ? [(NSString *)data lengthOfBytesUsingEncoding:NSUTF8StringEncoding] : [data length];
        
    NSMutableData *frame = [[NSMutableData alloc] initWithLength:payloadLength + SRFrameHeaderOverhead];
  	// 这里是先粗略计算下是否还有能容下这个 webSocket 帧的内存大小
    if (!frame) {
        [self closeWithCode:SRStatusCodeMessageTooBig reason:@"Message too big"];
        return;
    }
    uint8_t *frame_buffer = (uint8_t *)[frame mutableBytes];
    
    // 写 FIN、RSV、Opcode 位
    frame_buffer[0] = SRFinMask | opcode;
    
  	// 协议规定  客户端发送的帧 Mask 需设置为 1
    BOOL useMask = YES;
#ifdef NOMASK
    useMask = NO;
#endif
    
  	// 写 Mask 位
    if (useMask) {
    // set the mask and header
        frame_buffer[1] |= SRMaskMask;
    }
    
    size_t frame_buffer_size = 2;
    
    const uint8_t *unmasked_payload = NULL;
    if ([data isKindOfClass:[NSData class]]) {
        unmasked_payload = (uint8_t *)[data bytes];
    } else if ([data isKindOfClass:[NSString class]]) {
        unmasked_payload =  (const uint8_t *)[data UTF8String];
    } else {
        return;
    }
    
  	// 写 Payload Length / Extension Payload Length
    if (payloadLength < 126) {
      	// Payload Length 7位可以表示
        frame_buffer[1] |= payloadLength;
    } else if (payloadLength <= UINT16_MAX) {
      	// Payload Length 需用16位表示
        frame_buffer[1] |= 126;
        *((uint16_t *)(frame_buffer + frame_buffer_size)) = EndianU16_BtoN((uint16_t)payloadLength);
        frame_buffer_size += sizeof(uint16_t);
    } else {
      	// Payload Length 需用64位表示
        frame_buffer[1] |= 127;
        *((uint64_t *)(frame_buffer + frame_buffer_size)) = EndianU64_BtoN((uint64_t)payloadLength);
        frame_buffer_size += sizeof(uint64_t);
    }
        
    if (!useMask) {
      	// 不使用掩码  直接写 Payload
        for (size_t i = 0; i < payloadLength; i++) {
            frame_buffer[frame_buffer_size] = unmasked_payload[i];
            frame_buffer_size += 1;
        }
    } else {
      	// 使用掩码  先写 Masking Key
        uint8_t *mask_key = frame_buffer + frame_buffer_size;
        SecRandomCopyBytes(kSecRandomDefault, sizeof(uint32_t), (uint8_t *)mask_key);
        frame_buffer_size += sizeof(uint32_t);
        
        // TODO: could probably optimize this with SIMD
      	// 写掩码后的 Payload
        for (size_t i = 0; i < payloadLength; i++) {
            frame_buffer[frame_buffer_size] = unmasked_payload[i] ^ mask_key[i % sizeof(uint32_t)];
            frame_buffer_size += 1;
        }
    }

    assert(frame_buffer_size <= [frame length]);
  
  	// 这里校正实际的帧大小
    frame.length = frame_buffer_size;
    
    [self _writeData:frame];
}
```

sendFrameWithOpcode 方法的作用是把 Payload 数据根据 Opcode 包装成 webSocket 帧，最后调用 writeData 将数据写到缓存区。

```objc
- (void)_writeData:(NSData *)data;
{    
    [self assertOnWorkQueue];

  	// 用来表示是否是在完成写入后关闭连接
    if (_closeWhenFinishedWriting) {
            return;
    }
  
  	// 将 webSocket 帧数据拼接到输出缓存区
    [_outputBuffer appendData:data];
...
}
```

到这里，我们已经将 webSocket 帧打包好拼接到了输出缓存区，下一步是需要将输出缓存区可输出的数据写入到输出流中，就是 pumpWriting。

```objc
- (void)_pumpWriting;
{
    [self assertOnWorkQueue];
    
    NSUInteger dataLength = _outputBuffer.length;
  	// 输出缓存区有新的数据内容输出，并且输出流有空间可以写
    if (dataLength - _outputBufferOffset > 0 && _outputStream.hasSpaceAvailable) {
      	// 写入到输出流中
        NSInteger bytesWritten = [_outputStream write:_outputBuffer.bytes + _outputBufferOffset maxLength:dataLength - _outputBufferOffset];
        if (bytesWritten == -1) {
            [self _failWithError:[NSError errorWithDomain:SRWebSocketErrorDomain code:2145 userInfo:[NSDictionary dictionaryWithobjc:@"Error writing to stream" forKey:NSLocalizedDescriptionKey]]];
             return;
        }
        
      	// 更新已写偏移量
        _outputBufferOffset += bytesWritten;
        
      	// 优化内存使用
        if (_outputBufferOffset > 4096 && _outputBufferOffset > (_outputBuffer.length >> 1)) {
            _outputBuffer = [[NSMutableData alloc] initWithBytes:(char *)_outputBuffer.bytes + _outputBufferOffset length:_outputBuffer.length - _outputBufferOffset];
            _outputBufferOffset = 0;
        }
    }
    
  	// 这里如果 closeWhenFinishedWriting 被设置为 YES，并且所有数据都已完成写入，会主动关闭连接
    if (_closeWhenFinishedWriting && 
        _outputBuffer.length - _outputBufferOffset == 0 && 
        (_inputStream.streamStatus != NSStreamStatusNotOpen &&
         _inputStream.streamStatus != NSStreamStatusClosed) &&
        !_sentClose) {
        _sentClose = YES;
        
        @synchronized(self) {
          	// 关闭输入输出流
            [_outputStream close];
            [_inputStream close];
            
            // 移除 runloop
            for (NSArray *runLoop in [_scheduledRunloops copy]) {
                [self unscheduleFromRunLoop:[runLoop objcAtIndex:0] forMode:[runLoop objcAtIndex:1]];
            }
        }
        
        if (!_failed) {
          	// 回调上层
            [self _performDelegateBlock:^{
                if ([self.delegate respondsToSelector:@selector(webSocket:didCloseWithCode:reason:wasClean:)]) {
                    [self.delegate webSocket:self didCloseWithCode:_closeCode reason:_closeReason wasClean:YES];
                }
            }];
        }
        
        [self _scheduleCleanup];
    }
}
```

pumpWriting 完成了从输出缓存区到输出流的数据写入，剩下的就是输出流将数据发送到服务端的 Input，底层已经帮我们处理了。

## 关闭连接

查看 SRWebSocket 的头文件会发现，监听 webSocket 异常关闭的方法有两个。

```objc
- (void)webSocket:(SRWebSocket *)webSocket didFailWithError:(NSError *)error;
- (void)webSocket:(SRWebSocket *)webSocket didCloseWithCode:(NSInteger)code reason:(NSString *)reason wasClean:(BOOL)wasClean;
```

查看源码会发现 didCloseWithCode 一般处理的是部分协议规定的 webSocket 状态码，而 didFailWithError 一般处理 webSocket 在建连阶段的异常，比如 Header 解析异常、超时异常，以及一些输入输出流的异常报错。可以理解为常见的 webSocket 协议的状态异常由 didCloseWithCode 回调，其他情况则由 didFailWithError 覆盖。正如前面提到的，两端关闭 webSocket 连接不能只是单纯的断开 TCP，需两端在 webSocket 层面协商后再执行。SRWebSocket 在处理客户端主动断开时，只是向服务端发送 Close 帧，然后等待服务端返回 Close 后再清理资源断开连接。

# 封装 SRWebSocket

之前公司使用 SRWebSocket 有几个需求，一是需要在 TCP 连接前先做 DNS 预解析，二是需要给 webSocket 各阶段做行为打点统计耗时，三是添加重连功能。实现思路是在 SRWebSocket 层加入 DNS 预解析，调整建连顺序，添加几个 SR_ReadyState，虽然这不是按协议标准。重连和打点则单独封装一层来做，尽量少去修改 SRWebSocket 源码。最终的 Repo 地址：[XPWebSocket](https://github.com/XiaopingSun/XPWebSocket)

# 后记

SRWebSocket 这篇博客算是一个心结吧，从我牛离职后，总感觉有什么事情没有做完，现在心结已了，很开心！之后要继续学习自己喜欢的音视频开发了，也会把学到的东西第一时间在这里更新，加油吧骚年！
