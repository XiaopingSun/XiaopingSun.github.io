---
title: iOS 使用 VideoToolBox 编码 H.264
date: 2022-05-06 15:37:09
index_img: https://hexo.qiniu.pursue.top/WX20220506-154108%402x.png
banner_img:
categories: 音视频开发
tags: [VideoToolBox, 编码]
sticky:
---

# 前言

上一篇使用了 AudioToolBox 将音频数据编码成 AAC，这次的需求是将视频帧编码成 H264。在 iOS 8.0 之前，如果要在 iOS 平台上硬编码 H264 只能使用 AVAssetWriter 的野路子"曲线救国"，先利用系统硬编将视频帧写到本地 mp4 文件里，然后需要自己写逻辑去 mp4 的 Box 里读取 sps、pps 和 NALU 数据，会有频繁的文件读写操作。iOS 8.0 苹果提供了 VideoToolBox 来支持硬件的编解码，大大提升了开发效率，让开发者可以直接拿到编码后的数据，因此我们视频编码基于 VideoToolBox 来实现。

# 实现思路

使用 VideoToolBox 一般会用到 VTCompressionSessionRef 这个类，使用方式比较简单，首先调用 VTCompressionSessionCreate 创建编码器实例：

```objc
VT_EXPORT OSStatus
VTCompressionSessionCreate(
	CM_NULLABLE CFAllocatorRef							allocator, // 内存分配器，传 NULL 即可
	int32_t												width,  // 编码分辨率宽
	int32_t												height, // 编码分辨率高
	CMVideoCodecType									codecType,  // 编码器类型 kCMVideoCodecType_H264
	CM_NULLABLE CFDictionaryRef							encoderSpecification, // NULL 使用默认编码器
	CM_NULLABLE CFDictionaryRef							sourceImageBufferAttributes, // pixelBuffer 属性
	CM_NULLABLE CFAllocatorRef							compressedDataAllocator, // 内存分配器，传 NULL 即可
	CM_NULLABLE VTCompressionOutputCallback				outputCallback, // 编码完成的回调函数
	void * CM_NULLABLE									outputCallbackRefCon,  // 回调函数上下文指针
	CM_RETURNS_RETAINED_PARAMETER CM_NULLABLE VTCompressionSessionRef * CM_NONNULL // 实例
  compressionSessionOut) API_AVAILABLE(macosx(10.8), ios(8.0), tvos(10.2));
```

实例创建好后，可以给编码器配置输出参数，一般常用的属性有帧率、码率、GOP大小、profileLevel，注意 propertyValue 是 CoreFoundation 类型，需要手动管理指针的释放：

```objc
VT_EXPORT OSStatus
VTSessionSetProperty(
  CM_NONNULL VTSessionRef       session,  // 实例
  CM_NONNULL CFStringRef        propertyKey,  // key
  CM_NULLABLE CFTypeRef         propertyValue  // value
) API_AVAILABLE(macosx(10.8), ios(8.0), tvos(10.2));
```

配置好属性，调用方法让编码器分配足够内存准备编码（可选）：

```objc
VT_EXPORT OSStatus
VTCompressionSessionPrepareToEncodeFrames( CM_NONNULL VTCompressionSessionRef session ) API_AVAILABLE(macosx(10.9), ios(8.0), tvos(10.2));
```

准备工作完成，就可以将采集到的视频数据送入编码器了：

```objc
VT_EXPORT OSStatus
VTCompressionSessionEncodeFrame(
	CM_NONNULL VTCompressionSessionRef	session,  // 实例
	CM_NONNULL CVImageBufferRef			imageBuffer,	// 采集的视频帧
	CMTime								presentationTimeStamp,	// pts
	CMTime								duration, // may be kCMTimeInvalid 
	CM_NULLABLE CFDictionaryRef			frameProperties, // 视频帧属性  没有变化传 NULL 即可
	void * CM_NULLABLE					sourceFrameRefcon,  // 这一帧的上下文  会在 callback 里回调
	VTEncodeInfoFlags * CM_NULLABLE		infoFlagsOut  // 用来获取编码器状态  传 NULL 即可
) API_AVAILABLE(macosx(10.8), ios(8.0), tvos(10.2));
```

编码器在编码一帧后会回调在 VTCompressionSessionCreate 传入的 outputCallback 函数，将编码后的数据和上下文指针回调出来：

```objc
typedef void (*VTCompressionOutputCallback)(
		void * CM_NULLABLE outputCallbackRefCon,  // 创建编码器时指定的上下文指针
		void * CM_NULLABLE sourceFrameRefCon,   // 编码每一帧时指定的上下文指针
		OSStatus status, 		// 该帧编码状态
		VTEncodeInfoFlags infoFlags,   // 编码器状态信息
		CM_NULLABLE CMSampleBufferRef sampleBuffer );  // 编码后的数据
```

拿到 sampleBuffer 就可以解析出视频帧编码后的数据和一些其他信息了。

# 代码实现

首先创建编码器实例，配置属性：

```objc
- (void)setupCompressionSession {
    [_lock lock];
  	// 用户定义的编码参数信息
    XPVideoEncodeConfig *configuration = _videoEncodeConfig;
    OSStatus err = noErr;
    
    VTCompressionSessionRef session = NULL;
    NSDictionary *pixelBufferOptions = @{ (NSString*) kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
                                          (NSString*) kCVPixelBufferWidthKey : @([configuration videoSize].width),
                                          (NSString*) kCVPixelBufferHeightKey : @([configuration videoSize].height),
                                          (NSString*) kCVPixelBufferOpenGLESCompatibilityKey : @YES};
    
  	// 创建编码器实例，将当前编码器的类对象传入上下文参数
    err = VTCompressionSessionCreate(kCFAllocatorDefault,
                                     [configuration videoSize].width,
                                     [configuration videoSize].height,
                                     kCMVideoCodecType_H264,
                                     NULL,
                                     (__bridge CFDictionaryRef)pixelBufferOptions,
                                     kCFAllocatorDefault,
                                     &vtCallback,
                                     (__bridge void *)self, &session);
        
    if (err != noErr) {
        NSLog(@"error: failed to setup VTCompressionSession. %d", err);
    }
    
    _compressionSession = session;
    
    // 设置 GOP 长度、帧率
    if (err == noErr) {
        const int32_t interval = (int32_t)[configuration videoMaxKeyFrameInterval];
        const int32_t frameRate = (int32_t)[configuration expectedSourceVideoFrameRate];
        int32_t duration = (int32_t)(interval / frameRate);
        
      	// gop 长度：多少帧出现一个关键帧
        err = SetVTSessionIntProperty(session, kVTCompressionPropertyKey_MaxKeyFrameInterval, interval);
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
      	// 关键帧间隔时间 = gop 长度 / 帧率
        err = SetVTSessionIntProperty(session, kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, duration);
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
      	// 期望帧率
        err = SetVTSessionIntProperty(session, kVTCompressionPropertyKey_ExpectedFrameRate, frameRate);
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
    }
    
    // 禁止 B 帧
    if(err == noErr) {
        err = SetVTSessionBoolProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, false);
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
    }
    
    // 设置码率（后面会详细写）
    if(err == noErr) {
        err = [self setExpectedBitrate:[configuration averageVideoBitrate]];
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
    }
    
  	// 设置编码模式为 RealTime  保证直播场景的低延迟
    if(err == noErr) {
        err = SetVTSessionBoolProperty(session, kVTCompressionPropertyKey_RealTime, true);
        if(err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
    }
    
  	// 设置 profile Level
    if(err == noErr) {
        err = SetVTSessionStringProperty(session, kVTCompressionPropertyKey_ProfileLevel, (__bridge CFTypeRef)[configuration videoProfileLevel]);
        if(err != noErr) {
            NSLog(@" error:failed to setup VTCompressionSession. %d", err);
        }
    }
    
  	// 准备开始编码
    if (err == noErr) {
        err = VTCompressionSessionPrepareToEncodeFrames(session);
        if (err != noErr) {
            NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        }
    }
    
    if(err != noErr) {
        NSLog(@"error: failed to setup VTCompressionSession. %d", err);
        
        [_lock unlock];
        @throw [NSException exceptionWithName:kXPH264VTEncoderErrorInit
                                       reason:@"failed to setup VTCompressionSession"
                                     userInfo:nil];
        return;
    }
    [_lock unlock];
}
```

初始化方法里用到的 SetVTSession***Property 是封装的自定义函数，避免代码里频繁出现 CF 框架对象的创建和释放：

```objc
// Convenience function for setting a VT int32 property.
static OSStatus SetVTSessionIntProperty(VTSessionRef session,
                                        CFStringRef key,
                                        int32_t value) {
    CFNumberRef cfNum =
    CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &value);
    OSStatus status = VTSessionSetProperty(session, key, cfNum);
    CFRelease(cfNum);
    if (status != noErr) {
        NSLog(@"VTSessionSetProperty failed to set key: %@ with value: %d",
               (__bridge NSString*)key,
               value);
    }
    return status;
}

// Convenience function for setting a VT bool property.
static OSStatus SetVTSessionBoolProperty(VTSessionRef session,
                                         CFStringRef key,
                                         bool value) {
    CFBooleanRef cf_bool = (value) ? kCFBooleanTrue : kCFBooleanFalse;
    OSStatus status = VTSessionSetProperty(session, key, cf_bool);
    if (status != noErr) {
        NSLog(@"VTSessionSetProperty failed to set key: %@ with value: %@",
               (__bridge NSString*)key,
               value ? @"YES":@"NO");
    }
    
    return status;
}

// Convenience function for setting a VT string property.
static OSStatus SetVTSessionStringProperty(VTSessionRef session,
                          CFStringRef key,
                          CFStringRef value) {
    OSStatus status = VTSessionSetProperty(session, key, value);
    if (status != noErr) {
        NSLog(@"VTSessionSetProperty failed to set key: %@ with value: %@",
               (__bridge NSString*)key,
               (__bridge NSString*)value);
    }
    return status;
}
```

码率的设置会相对复杂一些，kVTCompressionPropertyKey_AverageBitRate 用来设置平均码率，实际的码率会围绕平均码率浮动，所以还需要设置一个浮动的范围：

```objc
- (OSStatus)setExpectedBitrate:(NSUInteger)averageBitrate {
    if (!_compressionSession) {
        return kNilOptions;
    }
    int bitrate = (int)averageBitrate;

  	// 设置平均码率
    OSStatus status;
    status = SetVTSessionIntProperty(_compressionSession,
                                     kVTCompressionPropertyKey_AverageBitRate,
                                     (int32_t)bitrate);
    if (status != noErr) {
        return status;
    }
    
  	// 设置码率浮动范围  kLimitToAverageBitRateFactor 是 1.5
    int64_t dataLimitBytesPerSecond = (int64_t)(bitrate * kLimitToAverageBitRateFactor / 8);
    CFNumberRef bytesPerSecondRef = CFNumberCreate(kCFAllocatorDefault,
                                                   kCFNumberSInt64Type,
                                                   &dataLimitBytesPerSecond);
    int64_t aSecond = 1;
    CFNumberRef aSecondRef = CFNumberCreate(kCFAllocatorDefault,
                                            kCFNumberSInt64Type,
                                            &aSecond);
    const void* nums[2] = { bytesPerSecondRef, aSecondRef };
    CFArrayRef dataRateLimitsRef = CFArrayCreate(NULL, nums, 2, &kCFTypeArrayCallBacks);
    status = VTSessionSetProperty(_compressionSession,
                                  kVTCompressionPropertyKey_DataRateLimits,
                                  dataRateLimitsRef);
    
    if (bytesPerSecondRef) {
        CFRelease(bytesPerSecondRef);
    }
    if (aSecondRef) {
        CFRelease(aSecondRef);
    }
    if (dataRateLimitsRef) {
        CFRelease(dataRateLimitsRef);
    }
    
    return status;
}
```

准备工作完成后，当采集到视频数据时就可以将其送进编码器了：

```objc
- (void)pushBuffer:(CVPixelBufferRef)pixelBuffer metaData:(XPMetaData *)metaData {
    if (_compressionSession == NULL) {
        return;
    }
    
    if (pixelBuffer == NULL) {
        NSLog(@"error: pixel buffer is NULL");
        return;
    }
    
    size_t width = CVPixelBufferGetWidth(pixelBuffer);
    size_t height = CVPixelBufferGetHeight(pixelBuffer);
    
    if (width == 0 || height == 0) {
        return;
    }
    
  	// 用户定义的编码参数
    XPVideoEncodeConfig *configuration = _videoEncodeConfig;
  
    /*
    	这里还需要对 pixelBuffer 的宽高做校验，保证与编码宽高的比例是一致的
    */
    
  	// 创建时间戳，timescale 需要指定为 1000，metaData.pts 是采集视频帧时打的时间戳，单位 ms
    CMTime presentationTime = {0};
    presentationTime.timescale = 1000;   // has to be 1000 !
    presentationTime.value = metaData.pts;
    presentationTime.flags = kCMTimeFlags_Valid;
    
  	// pixelBuffer 送入编码器
    [_lock lock];
    VTEncodeInfoFlags flags;
    VTCompressionSessionEncodeFrame(_compressionSession, pixelBuffer, presentationTime, kCMTimeInvalid, NULL, NULL, &flags);
    [_lock unlock];
}
```

VideoToolBox 编码完成后会回调先前定义的回调函数：

```objc
static void vtCallback(
                       void * CM_NULLABLE outputCallbackRefCon,
                       void * CM_NULLABLE sourceFrameRefCon,
                       OSStatus status,
                       VTEncodeInfoFlags infoFlags,
                       CM_NULLABLE CMSampleBufferRef sampleBuffer ) {
    
  	// 获取当前编码器类的实例对象
    XPVTH264Encoder *encoder = (__bridge XPVTH264Encoder *)outputCallbackRefCon;
    if (!encoder) {
        return;
    }
    
  	// CMBlockBufferRef 封装了编码后的数据块
    CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sampleBuffer);
  	// attachments 包含一些编码的额外信息  比如当前是否是关键帧
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
  	// 获取当前编码数据块的时间戳
    CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    
  	// 判断是否为关键帧
    bool isKeyframe = false;
    if (attachments !=  NULL) {
        CFDictionaryRef attachment;
        CFBooleanRef dependsOnOthers;
        attachment = (CFDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        dependsOnOthers = (CFBooleanRef)CFDictionaryGetValue(attachment, kCMSampleAttachmentKey_DependsOnOthers);
        isKeyframe = (dependsOnOthers == kCFBooleanFalse);
    }
    
  	// 如果是第一个关键帧，需要获取 sps、pps 打包成 flv 的首个 video tag
    if (isKeyframe && !encoder.isConfigSent) {
        size_t spsSize = 0, ppsSize = 0;
        const uint8_t* sps = NULL, *pps = NULL;
        
        // Send the SPS and PPS.
        CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
        size_t paramCount;
        
      	// 获取 sps 及其长度
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, 0, &sps, &spsSize, &paramCount, NULL);
      	// 获取 pps 及其长度
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, 1, &pps, &ppsSize, &paramCount, NULL);
        
        /*
        	这里将 sps 和 pps 回调给上层封装处理
        */
        
        encoder.configSent = YES;
    }
    
    char* bufferData;
    size_t size;
    uint8_t *naluData;
    
  	// 从 CMBlockBufferRef 中获取编码后的数据块的指针地址和数据长度
    status = CMBlockBufferGetDataPointer(block, 0, NULL, &size, &bufferData);
    
    if (status == noErr) {
        naluData = (uint8_t *)malloc(size);
        memcpy(naluData, (uint8_t *)bufferData, size);
        
      	/*
        	这里将编码数据回调给上层封装处理
        */
        
    } else {
        NSLog(@"error: video toolbox encoder error: %d", status);
    }
}
```

在收到第一个编码后的关键帧时，先从 SampleBuffer 里解析出 sps 和 pps，将其封装成 AVCC 的 extradata ，打包成 flv tag，并作为第一个 video tag 发送给服务端。通过 CMBlockBufferGetDataPointer 方法拿到的编码数据块中可能包含多个 NALU，苹果有时会将 SEI 和 IDR 帧放到同一个 CMBlockBuffer 中，如果需要把每个 NALU 单独解析出来，可以判断前 4 个字节的 NALU 长度，将 NALU 一个一个解析出来。

iOS 平台的 h264 硬编码使用的都是 AVCC，而非 Annex B，在实际使用编码数据的过程中，需要根据不同的场景对 NALU 做转换。RTMP 协议使用 flv 的封装格式，而恰好 flv 也是用 AVCC，所以封装的时候就很方便了。

使用结束之后，别忘了释放编码器实例：

```objc
- (void)teardownCompressionSession {
    [_lock lock];
    if (_compressionSession) {
        VTCompressionSessionInvalidate(_compressionSession);
        CFRelease(_compressionSession); 
        _compressionSession = NULL;
    }
    [_lock unlock];
}
```

# 后记

下一步，flv 封装！
