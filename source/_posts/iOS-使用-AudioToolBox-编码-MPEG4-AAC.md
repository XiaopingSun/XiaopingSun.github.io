---
title: iOS 使用 AudioToolBox 编码 MPEG4-AAC
date: 2022-05-04 14:29:18
index_img: https://hexo.qiniu.pursue.show/coreaudio.png
banner_img:
categories: 音视频开发
tags: [Core Audio, 编码]
sticky:
---

# 前言

上一篇使用 Audio Unit 实现了麦克风数据的采集，下一步需要将音频数据送到编码器编码，一般 RTMP 协议使用的音频编码格式是 AAC，而恰好苹果的 Core Audio 下有提供给我们音频格式转换的工具 - AudioConvertRef。

# 实现思路

AudioConvertRef 接口比较简单，AudioConverterNewSpecific 函数指定编码器类型和输入输出的 ASBD 创建实例：

```objc
//-----------------------------------------------------------------------------
/*!
    @function   AudioConverterNewSpecific
    @abstract   Create a new AudioConverter using specific codecs.

    @param      inSourceFormat
                    The format of the source audio to be converted.
    @param      inDestinationFormat
                    The destination format to which the audio is to be converted.
    @param      inNumberClassDescriptions
                    The number of class descriptions.
    @param      inClassDescriptions
                    AudioClassDescriptions specifiying the codec to instantiate.
    @param      outAudioConverter
                    On successful return, points to a new AudioConverter instance.
    @result     An OSStatus result code.
    
	This function is identical to AudioConverterNew(), except that the client may
	explicitly choose which codec to instantiate if there is more than one choice.
*/
extern OSStatus
AudioConverterNewSpecific(  const AudioStreamBasicDescription * inSourceFormat,
                            const AudioStreamBasicDescription * inDestinationFormat,
                            UInt32                              inNumberClassDescriptions,
                            const AudioClassDescription *       inClassDescriptions,
                            AudioConverterRef __nullable * __nonnull outAudioConverter)
                                                                                API_AVAILABLE(macos(10.4), ios(2.0), watchos(2.0), tvos(9.0));
```

AudioConverterFillComplexBuffer 函数传入目标 AudioBufferList 和回调函数 inInputDataProc，之后 AudioConvertRef 会同步调用该回调函数 inInputDataProc 问我们要 PCM 原始数据，在检查数据没有问题之后编码器将开始编码：

```objc
//-----------------------------------------------------------------------------
/*!
    @function   AudioConverterFillComplexBuffer
    @abstract   Converts data supplied by an input callback function, supporting non-interleaved
                and packetized formats.

    @param      inAudioConverter
                    The AudioConverter to use.
    @param      inInputDataProc
                    A callback function which supplies the input data.
    @param      inInputDataProcUserData
                    A value for the use of the callback function.
    @param      ioOutputDataPacketSize
                    On entry, the capacity of outOutputData expressed in packets in the
                    converter's output format. On exit, the number of packets of converted
                    data that were written to outOutputData.
    @param      outOutputData
                    The converted output data is written to this buffer. On entry, the buffers'
                    mDataByteSize fields (which must all be the same) reflect buffer capacity.
                    On exit, mDataByteSize is set to the number of bytes written.
    @param      outPacketDescription
                    If non-null, and the converter's output uses packet descriptions, then
                    packet descriptions are written to this array. It must point to a memory
                    block capable of holding *ioOutputDataPacketSize packet descriptions.
                    (See AudioFormat.h for ways to determine whether an audio format
                    uses packet descriptions).
    @result     An OSStatus result code.

	Produces a buffer list of output data from an AudioConverter. The supplied input
	callback function is called whenever necessary.
*/
extern OSStatus
AudioConverterFillComplexBuffer(    AudioConverterRef                   inAudioConverter,
                                    AudioConverterComplexInputDataProc  inInputDataProc,
                                    void * __nullable                   inInputDataProcUserData,
                                    UInt32 *                            ioOutputDataPacketSize,
                                    AudioBufferList *                   outOutputData,
                                    AudioStreamPacketDescription * __nullable outPacketDescription)
                                                                                API_AVAILABLE(macos(10.2), ios(2.0), watchos(2.0), tvos(9.0));
```

使用完调用 AudioConverterDispose 释放资源：

```objc
//-----------------------------------------------------------------------------
/*!
    @function   AudioConverterDispose
    @abstract   Destroy an AudioConverter.

    @param      inAudioConverter
                    The AudioConverter to dispose.
    @result     An OSStatus result code.
*/
extern OSStatus
AudioConverterDispose(  AudioConverterRef   inAudioConverter)                   API_AVAILABLE(macos(10.1), ios(2.0), watchos(2.0), tvos(9.0));
```

有两个问题需要额外注意下：

一是送入编码器的数据量。AudioConverterFillComplexBuffer 的 ioOutputDataPacketSize 参数需要指定编码器此次编码的 aac packet 数量，通常 AAC-LC 一个 packet 包含 1024 个 pcm frame，所以每次送入编码器的 pcm frame 个数需要是 1024 * 通道数 的整数倍。但使用 Audio Unit 采集音频每次回调的 frame 个数是不确定的，可能会比 1024 小，所以音频数据在送到编码器之前需要先加入一个 Buffer Data 队列里，满足数量要求再从队列取出送进编码器。

另一个是时间戳的计算，在后续封装 Flv 时需要在 Tag Header 里指定这一帧起始位置的时间戳，为了保证音画同步，需要计算原始数据产生时的时间戳，我们在 Audio Unit 回调时打了一个时间戳，但这个时间戳至少是在此 Buffer 最后一个采样点产生时生成的，需要校准成第一个采样点产生时的时间，这个偏移量很好计算，用采样点个数除以采样率。由于 Buffer Data 需要先加入队列后取出，所以 Meta Data 也需要同样的操作，取出时需要再计算一个偏移量，保证给编码器的 Buffer 首个采样点的时间是对的。

{% note warning %}
实际测试过程中发现，在送入第一个 1024 frame 的 Buffer Data 给编码器后，输出的 Packet Size 只有 4 个字节，这显然是不足以压缩 1024 个 frame 的，由于目前还不太清楚编码器底层的实现，盲猜一下可能是编码器内部也有缓存，如果是这样的话，那上边计算时间戳的方式也是有偏差的，但实际影响不大，测试效果是 OK 的。
{% endnote %}

# 代码实现

输出的 ASBD 指定 mFormatID 为 kAudioFormatMPEG4AAC，mChannelsPerFrame 为通道数，其他参数设置为 0 即可：

```objc
_destASBD = calloc(1, sizeof(AudioStreamBasicDescription));
_destASBD->mFormatID = kAudioFormatMPEG4AAC;
_destASBD->mFormatFlags = 0;
_destASBD->mBytesPerFrame = 0;
_destASBD->mBytesPerPacket = 0;
_destASBD->mChannelsPerFrame = 1;
```

AudioConverterRef 初始化：

```objc
...
  	// 定义软解、硬解编码器
    AudioClassDescription codecs[2] = {
        {
            kAudioEncoderComponentType,
            kAudioFormatMPEG4AAC,
            kAppleSoftwareAudioCodecManufacturer
        },
        {
            kAudioEncoderComponentType,
            kAudioFormatMPEG4AAC,
            kAppleHardwareAudioCodecManufacturer
        }
    };
    
  	// 初始化 AudioConverterRef  输入源的 ASBD 可以从采集类拿到
    if (XPAudioUnitCheckError(AudioConverterNewSpecific(self.sourceASBD, self.destASBD, 2, codecs, &_context.audioConverter), "AudioConverterNewSpecific error")) {
        return;
    }
    
  	// 设置输出码率  一般 AAC 可设置的码率为 64Kbps、96Kbps、128Kbps
    UInt32 encodeBitrate = 128000;
    if (XPAudioUnitCheckError(AudioConverterSetProperty(_context.audioConverter, kAudioConverterEncodeBitRate, sizeof(encodeBitrate), &encodeBitrate), "set encode bitrate error")) {
        return;
    }
    
  	// 获取编码输出的最大 packet size，用于初始化接收编码数据的 AudioBuffer
    UInt32 maxOutputPacketSize = 0;
    UInt32 propertySize = sizeof(maxOutputPacketSize);
    if (XPAudioUnitCheckError(AudioConverterGetProperty(_context.audioConverter, kAudioConverterPropertyMaximumOutputPacketSize, &propertySize, &maxOutputPacketSize), "get max output packet size error")) {
        return;
    }
    
  	// 这里初始化 PCM Buffer Data 和 Meta Data 的队列
    _PCMDataQueue = [[XPPCMDataQueue alloc] initWithPCMFramesPerAACPacket:kPCMFramesPerAACPacket bytesPerPCMFrame:self.sourceASBD->mBytesPerFrame sampleRate:self.sourceASBD->mSampleRate];
  
  	// 将一些参数设置给 context
    _context.maxOutputPacketSize = maxOutputPacketSize;
    _context.channelCount = self.sourceASBD->mChannelsPerFrame;
    _context.bytesPerFrame = self.sourceASBD->mBytesPerFrame;
...
```

最后几行用到的 context 是一个结构体，用来在调用 AudioConverterFillComplexBuffer 方法时给回调函数传入一个 user data，便于在回调函数里使用这些参数：

```objc
typedef struct {
    AudioConverterRef audioConverter;
    UInt32 maxOutputPacketSize;
    UInt32 channelCount;
    UInt32 bytesPerFrame;
    NSMutableArray<NSData *> *PCMBufferDataList;
    NSData *currentBufferData;
} AudioConverterContext;
```

接收到音频数据和时间戳后，将它们 push 进队列里，满足一定数量帧个数时从队列里取出并计算起始帧的时间戳，最后送入编码器。等待编码器编码完成，将 AAC Frame 回调给上层做封装处理：

```objc
...
  	// 计算 audioBuffer 包含的 frame 个数
    UInt32 frameCount = audioBuffer->mDataByteSize / self.sourceASBD->mBytesPerFrame;
    
    // 将 pts 对齐到 buffer 的首个采样点  音频 dts 和 pts 保持一致即可
    if (metaData.pts > 1000 * frameCount / self.sourceASBD->mSampleRate) {
        metaData.pts -= 1000 * frameCount / self.sourceASBD->mSampleRate;
    } else {
        metaData.pts = 0;
    }
    metaData.dts = metaData.pts;
    
    // bufferData 和 metaData 加入到队列（audioBuffer 由上层释放 这里 freeWhenDone 为 NO）
    NSData *bufferData = [NSData dataWithBytesNoCopy:audioBuffer->mData length:audioBuffer->mDataByteSize freeWhenDone:NO];
  
  	// bufferData 和 metaData 送入队列
    [_PCMDataQueue enqueueBufferData:bufferData];
    [_PCMDataQueue enqueueMetaData:metaData frameCount:frameCount];
    
    // 尝试从队列中取出 bufferData
    NSData *dequeueBufferData = nil;
    while (1) {
        dequeueBufferData = [_PCMDataQueue dequeueBufferData];
        if (!dequeueBufferData) {
            break;
        }
        [_context.PCMBufferDataList addObject:dequeueBufferData];
    }
    
    // 计算此次送入编码器的 Buffer 总长度
    size_t totalBufferBytes = 0;
    for (NSData *data in _context.PCMBufferDataList) {
        totalBufferBytes += data.length;
    }
    
    // 计算编码前的 frame 个数、编码后的 facket 个数
    size_t totalFrameCount = totalBufferBytes / self.sourceASBD->mBytesPerFrame;
    size_t totalPacketCount = totalFrameCount / kPCMFramesPerAACPacket;
    
    // 如果不足一个 packet 直接返回
    if (!totalPacketCount) {
        return;
    }
    
    // 循环编码每个 AAC Packet
    for (int i = 0; i < totalPacketCount; i++) {
        @autoreleasepool {
            uint8_t *outputBuffer = (uint8_t *)calloc(1, _context.maxOutputPacketSize);
            UInt32 numberOfPackets = 1;
            
          	// 初始化用于接收 AAC Packet 的 AudioBufferList，每次问编码器要 1 个 Packet
            AudioBufferList l;
            l.mNumberBuffers = 1;
            l.mBuffers[0].mNumberChannels = _context.channelCount;
            l.mBuffers[0].mDataByteSize = _context.maxOutputPacketSize;
            l.mBuffers[0].mData = outputBuffer;
            
          	// 开始编码，设置回调函数 ioProcess，设置 user data 为之前定义的 context
            if (XPAudioUnitCheckError(AudioConverterFillComplexBuffer(_context.audioConverter,
                                                                      ioProcess,
                                                                      &_context,
                                                                      &numberOfPackets,
                                                                      &l,
                                                                      NULL),
                                      "AudioConverterFillComplexBuffer error")) {
                
                free(outputBuffer);
                return;
            }
            
          	// 到这一步已经可以获取编码结果了，AudioConverterRef 会将实际编码的 Packet 数量写回 numberOfPackets
            if (numberOfPackets) {
              	// 走到这里说明已经成功拿到编码数据
              	// 计算时间戳偏移，从队列中取出
                XPMetaData *dequeuedMetaData = [_PCMDataQueue dequeueMetaData];
                NSAssert(dequeuedMetaData, @"Something wrong with meta data queue");
                
                // send aac raw
                XPAACFrame *aacFrame = [XPAACFrame frameWithType:XPAACFrameType_Raw data:outputBuffer dataSize:l.mBuffers[0].mDataByteSize];
                if (self.delegate && [self.delegate respondsToSelector:@selector(aacEncoder:didGetAACFrame:metaData:channelCount:sampleRate:)]) {
                    [self.delegate aacEncoder:self didGetAACFrame:aacFrame metaData:dequeuedMetaData channelCount:self.audioEncodeConfig.encodeChannelCount sampleRate:(UInt32)self.audioEncodeConfig.encodeSampleRate];
                }
            } else {
              	// 此次没有编码数据输出  释放资源  等待下一次
                free(outputBuffer);
            }
        }
    }
...
```

调用 AudioConverterFillComplexBuffer 方法后，如果传入的参数都没问题，AudioConverterRef 会去调用回调函数 ioProcess：

```objc
static OSStatus ioProcess(AudioConverterRef inAudioConverter,
                          UInt32 *ioNumberDataPackets,
                          AudioBufferList *ioData,
                          AudioStreamPacketDescription * __nullable * __nullable outDataPacketDescription,
                          void * __nullable inUserData) {
    
  	// user data 转成 AudioConverterContext
    AudioConverterContext *context = (AudioConverterContext *)inUserData;
    if (!context || !context->PCMBufferDataList.count) {
        *ioNumberDataPackets = 0;
        return kConverterShouldContinueCode;
    }
    
  	// 从 PCMBufferDataList 取出第一个 Buffer Data
    context->currentBufferData = context->PCMBufferDataList[0];
    [context->PCMBufferDataList removeObjectAtIndex:0];
    
  	// 计算 Buffer Data 中包含的 frame 个数
    UInt32 sampleCount = (UInt32)context->currentBufferData.length / context->bytesPerFrame;
    
  	// *ioNumberDataPackets 是 AudioConverterRef 告知我们此次编码需要的 frame 个数
    if (*ioNumberDataPackets < sampleCount) {
      	// 如果需要的个数比 Buffer Data 中的个数少，需要将剩余部分重新插入到 PCMBufferDataList
        NSData *dataToUse = [NSData dataWithBytes:context->currentBufferData.bytes length:*ioNumberDataPackets * context->bytesPerFrame];
        NSData *dataRemain = [NSData dataWithBytes:context->currentBufferData.bytes + *ioNumberDataPackets * context->bytesPerFrame length:(sampleCount - *ioNumberDataPackets) * context->bytesPerFrame];
        
        context->currentBufferData = dataToUse;
        [context->PCMBufferDataList insertObject:dataRemain atIndex:0];
      
      	// 实际送入的 frame 个数以 *ioNumberDataPackets 为准
        sampleCount = *ioNumberDataPackets;
    }
    
  	// *ioNumberDataPackets 需要赋值实际送入的 frame 个数
    *ioNumberDataPackets = sampleCount;
  
  	// 给 ioData 赋值
    ioData->mBuffers[0].mData = context->currentBufferData.bytes;
    ioData->mBuffers[0].mDataByteSize = (UInt32)context->currentBufferData.length;
    ioData->mBuffers[0].mNumberChannels = context->channelCount;
    
    return noErr;
}
```

在 ioProcess 回调函数的两个参数 ioNumberDataPackets 和 ioData 都是 io 开头，说明这两个参数不光作为输入，也要作为输出，也就是需要在回调函数里给它们赋值，如果传参没有问题就可以直接运行程序进行编码了。

{% note info %}

编码出的 AAC 裸数据不能直接拿来播放，一般有两种用途：

1.在裸数据前加一个 ADTS 或者 ADIF 写入本地，用于本地播放。

2.作为流媒体数据分发。如 Flv 格式，需要额外写入一个 Audio Specific Config 来描述 AAC 的信息。

{% endnote %}

# 后记

整体代码量是比较少的，实际调试过程中，内存的问题比较常见，比如一些 c 和 object-c 内存管理方式转换导致的 double free 问题，调试起来是比较麻烦的，不过调试的过程对理解苹果的设计模式和音视频数据的特性是很有帮助的。编码完成后，下一步就是封装了，不过在此之前还需要把 VideoToolbox 视频编码的部分写完，大概还得两周的时间吧。算一算自己在家已经宅了 1 个多月了，日子过的真滴舒服也真滴可怕，希望上海早日解封吧！
