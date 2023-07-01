---
title: iOS 使用 AVAssetWriter 实时写入视频流
date: 2022-08-06 22:09:30
index_img: https://hexo.qiniu.pursue.top/xcode_banner.png
banner_img:
categories: 音视频开发
tags: AVFoundation
sticky:
---

# 前言

好久没写博客了，这段时间几乎所有的精力都用在适应新工作上了，今天难得有些时间可以把这段时间做的需求整理一下，记一记写一写，加深下记忆吧。这个需求是在渲染引擎里加入录屏功能，将引擎渲染的纹理和麦克风采集的声音写入到本地 mp4 文件。

# 实现方法

可以将视频、音频分开录制，AVAssetWriter 将底层引擎回调的 RGB 数据写成 mp4 文件，使用 VideoToolBox 录制一路音频 m4a 保存本地，然后使用 AVAssetExportSession 将音频视频合成。这种方式实现是肯定没问题的，但过程有些繁琐，并且音频视频被多次编解码，效率很低。

AVAssetWriter 是支持实时写入音频和视频的，唯一要费点心思的是音视频同步。音频的采集使用 AVCaptureSession，比较简单，接口回调的音频数据类型是 CMSampleBufferRef，其中包含了时间戳信息，这个时间戳并不是从 0 开始的，所以收到音频首帧时需要记录下时间戳作为视频帧时间戳的 base time，此后的视频帧在此 base time 基础上叠加系统时间差值即可。

# 代码

首先是 AVAssetWriter 的初始化，这里分成两种情况，如果用户没有授权麦克风权限，则只录制引擎的视频纹理，如果授权，则录制纹理和声音：

```objc
- (BOOL)setupAssetWriter:(RecorderSourceType)sourceType {
    _sourceType = sourceType;
    NSError *error;

  	// 如果录制文件已存在，先移除
    if ([[NSFileManager defaultManager] fileExistsAtPath:_outputFilePath]) {
        [[NSFileManager defaultManager] removeItemAtPath:_outputFilePath error:&error];
        if (error) {
            NSLog(@"Remove item at outputFilePath failed: %@", error.localizedDescription);
            return NO;
        }
    }
    
  	// 初始化 AVAssetWriter，指定封装格式为 AVFileTypeMPEG4
    _assetWriter = [[AVAssetWriter alloc] initWithURL:[NSURL fileURLWithPath:_outputFilePath] fileType:AVFileTypeMPEG4 error:&error];
    if (error) {
        NSLog(@"AVAssetWriter create failed: %@", error.localizedDescription);
        return NO;
    }
    
  	// 初始化视频写入相关
    if (sourceType & RecorderSourceType_Video) {
      	// 分辨率
        CGSize outputSize = CGSizeMake(GetWidth(), GetHeight());
      	// 单帧像素点个数
        NSInteger numPixels = outputSize.width * outputSize.height;
      	// 码率因子
        CGFloat bitrateFactorPerPixel = 3.0;
      	// 估算一个码率
        NSInteger bitrate = numPixels * bitrateFactorPerPixel;
      	// 帧率
        NSInteger fps = 30;
      	// 关键帧间隔
        NSInteger keyFrameInterval = fps * 3;
        
        NSDictionary *videoCompressionProperties = @{AVVideoAverageBitRateKey : @(bitrate),
                                                     AVVideoExpectedSourceFrameRateKey : @(fps),
                                                     AVVideoMaxKeyFrameIntervalKey : @(keyFrameInterval),
                                                     AVVideoProfileLevelKey : AVVideoProfileLevelH264BaselineAutoLevel};
        
        NSDictionary *videoCompressionSettings = @{AVVideoCodecKey : AVVideoCodecTypeH264,
                                                   AVVideoScalingModeKey : AVVideoScalingModeResizeAspectFill,
                                                   AVVideoWidthKey  : @(outputSize.width),
                                                   AVVideoHeightKey : @(outputSize.height),
                                                   AVVideoCompressionPropertiesKey : videoCompressionProperties};
        
        if ([_assetWriter canApplyOutputSettings:videoCompressionSettings forMediaType:AVMediaTypeVideo]) {、
          	// 创建 AVAssetWriterInput
            _videoInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:videoCompressionSettings];
            _videoInput.expectsMediaDataInRealTime = YES;
            
            NSDictionary *sourcePixelBufferAttributes = @{(NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
                                                          (NSString *)kCVPixelBufferWidthKey: @(outputSize.width),
                                                          (NSString *)kCVPixelBufferHeightKey: @(outputSize.height)};
            // 创建 AVAssetWriterInputPixelBufferAdaptor
            _videoAdaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:_videoInput sourcePixelBufferAttributes:sourcePixelBufferAttributes];
       
            // AVAssetWriter 添加视频输入                                                                                               
            if ([_assetWriter canAddInput:_videoInput]) {
                [_assetWriter addInput:_videoInput];
            }
        }
    }
    
  	// 初始化音频写入相关
    if (sourceType & RecorderSourceType_Audio) {
      	// 采样率
        NSInteger sampleRate = 48000;
      	// 通道数
        NSInteger channelCount = 1;
      	// 码率
        NSInteger bitrate = 64000;
      	// 位深
        NSInteger bitDepth = 16;
        
        NSDictionary *audioCompressionSettings = @{AVFormatIDKey : @(kAudioFormatMPEG4AAC),
                                                   AVEncoderBitRatePerChannelKey : @(bitrate),
                                                   AVSampleRateKey : @(sampleRate),
                                                   AVNumberOfChannelsKey : @(channelCount)};
        
        if ([_assetWriter canApplyOutputSettings:audioCompressionSettings forMediaType:AVMediaTypeAudio]) {
          	// 创建 AVAssetWriterInput
            _audioInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:audioCompressionSettings];
            _audioInput.expectsMediaDataInRealTime = YES;
            
          	// AVAssetWriter 添加音频输入
            if ([_assetWriter canAddInput:_audioInput]) {
                [_assetWriter addInput:_audioInput];
            }
        }
    }
    
    return YES;
}
```

以上代码初始化 AVAssetWriter 并根据不同场景配置了音频和视频的输入，如果是授权了麦克风权限，还需要初始化 AVCaptureSession：

```objc
- (BOOL)setupAudioRecorder {
    NSError *error;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayAndRecord error:&error];
    [[AVAudioSession sharedInstance] setActive:YES error:&error];
    if (error) {
        NSLog(@"AVAudioSession set category & action error: %@", error.localizedDescription);
        return NO;
    }
    
    _audioBufferQueue = dispatch_queue_create("com.audioBuffer.IPhoneScreenRecorder", DISPATCH_QUEUE_SERIAL);
    _captureSession = [[AVCaptureSession alloc] init];
    AVCaptureDevice *audioDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
    _audioDeviceInput = [AVCaptureDeviceInput deviceInputWithDevice:audioDevice error:&error];
    if (error) {
        NSLog(@"AVCaptureDeviceInput create failed: %@", error.localizedDescription);
        return NO;
    }
    _audioDataOutput = [[AVCaptureAudioDataOutput alloc] init];
    [_audioDataOutput setSampleBufferDelegate:self queue:_audioBufferQueue];
    
    if ([_captureSession canAddInput:_audioDeviceInput]) {
        [_captureSession addInput:_audioDeviceInput];
    }
    if ([_captureSession canAddOutput:_audioDataOutput]) {
        [_captureSession addOutput:_audioDataOutput];
    }
    
    [_captureSession startRunning];
    return YES;
}
```

初始化完成后，需要处理开始写入的时机和音视频时间戳的同步，processVideoBuffer 方法是引擎回调纹理数据的接口，这里同样也分两种场景来处理：

```objc
- (void)processVideoBuffer:(void *)data width:(int)width height:(int)height {
    if (!_isRecording) return;
    if (!_canWrite) return;
    dispatch_async(_operationQueue, ^{
        if (_sourceType & RecorderSourceType_Audio) {
            if (_timeBase == 0) {
                // Need to wait for the audio buffer callback to update the timebase
                return;
            }
            
            TimeFormat currentTimeStamp = GetTimeStampOffset(_timeBase) + _timeBase;
            CMTime pts = CMTimeMake(currentTimeStamp, 1000);
            CVPixelBufferRef pixelBuffer = CreatePixelBuffer(data, width, height);
            if (pixelBuffer == NULL) return;

            [self appendVideoPixelBuffer:pixelBuffer pts:pts];
            
        } else {
            if (_timeBase == 0) {
                // Update timebase（ms）
                _timeBase = GetTimeStampInMS();
                // Start asset writer
                [_assetWriter startWriting];
              	// 视频帧的时间戳基数是从 0 开始的，所以这里是 kCMTimeZero
                [_assetWriter startSessionAtSourceTime:kCMTimeZero];
            }
            
            TimeFormat currentTimeStamp = GetTimeStampOffset(_timeBase);
            CMTime pts = CMTimeMake(currentTimeStamp, 1000);
            CVPixelBufferRef pixelBuffer = CreatePixelBuffer(data, width, height);
            if (pixelBuffer == NULL) return;

            [self appendVideoPixelBuffer:pixelBuffer pts:pts];
        }
    });
}
```

如果只录制视频，就不需要考虑时间戳对齐，在 AVAssetWriter 初始化完成后的第一帧即可记录时间基并开始写入。如果需要写入音频，就要保证音视频的时间基是相同的。既然音频回调的 CMSampleBufferRef 里有时间戳信息，那不如就用第一帧音频的时间戳作为视频的时间基，此后依次叠加系统时间的差值即可，所以这里 _timeBase 如果是 0，需要等待第一帧音频帧的到来，再看下音频帧回调里的处理：

```objc
#pragma mark - <AVCaptureAudioDataOutputSampleBufferDelegate>
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection {
    if (!_canWrite) return;
    dispatch_sync(_operationQueue, ^{
        if (_timeBase == 0) {
            CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
            // Update time base
            _timeBase = (TimeFormat)(CMTimeGetSeconds(pts) * 1000);
            // Start asset writer
            [_assetWriter startWriting];
            [_assetWriter startSessionAtSourceTime:CMSampleBufferGetPresentationTimeStamp(sampleBuffer)];
        }
        [self appendAudioSampleBuffer:sampleBuffer];
    });
}
```

在 AVAssetWriter 初始化完成后，收到的音频首帧里包含的时间戳会作为时间基赋值给 _timeBase，并开始 AVAssetWriter 的写入任务，startSessionAtSourceTime 要传入第一帧音频的时间戳信息。processVideoBuffer 方法中视频帧也会基于音频首帧的时间戳来写入，这样就实现了一个简单的，比较粗略的时间戳同步。

最后是音频和视频 buffer 的写入：

```objc
- (void)appendVideoPixelBuffer:(CVPixelBufferRef)pixelBuffer pts:(CMTime)pts {
    if (!_isRecording || _assetWriter.status != AVAssetWriterStatusWriting) {
        CFRelease(pixelBuffer);
        return;
    }
    
    dispatch_async(_writingQueue, ^{
        AVAssetWriterInput *input = _videoInput;
        if (input.readyForMoreMediaData) {
            BOOL success = [_videoAdaptor appendPixelBuffer:pixelBuffer withPresentationTime:pts];
            if (!success) {
                [self stopRecordingWithCompletion:nil];
                NSError *error = _assetWriter.error;
                NSLog(@"AVAssetWriterInputPixelBufferAdaptor appendPixelBuffer failed with error: %@", error.localizedDescription);
            }
        } else {
            NSLog( @"Video input not ready for more media data, dropping buffer");
        }
        CFRelease(pixelBuffer);
    });
}

- (void)appendAudioSampleBuffer:(CMSampleBufferRef)sampleBuffer {
    if (!_isRecording || _assetWriter.status != AVAssetWriterStatusWriting) {
        return;
    }
    
    CFRetain(sampleBuffer);
    dispatch_async(_writingQueue, ^{
        if (_audioInput.readyForMoreMediaData) {
            BOOL success = [_audioInput appendSampleBuffer:sampleBuffer];
            if (!success) {
                [self stopRecordingWithCompletion:nil];
                NSError *error = _assetWriter.error;
                NSLog(@"AVAssetWriterInput appendSampleBuffer failed with error: %@", error.localizedDescription);
            }
        } else {
            NSLog( @"Audio input not ready for more media data, dropping buffer");
        }
        CFRelease(sampleBuffer);
    });
}
```

在写入视频帧时，起初跟音频一样，也是使用 AVAssetWriterInput 的 appendSampleBuffer 来写入，但发现一直写入失败，苹果的报错只是说 unknown error，没有给出具体原因，之后在 Stack Overflow 上看有人遇到同样的问题，改用 AVAssetWriterInputPixelBufferAdaptor 写入 CVPixelBufferRef 可以解决，亲测是有效的，但具体原因就没有深究了。

# 参考资料

主要是苹果的接口文档了，还有一个网上找的 AVFoundation 的使用 Demo 用来参考：[Demo](https://github.com/geniusZhangXu/AVFoundation)

# 后记

现在是 23:26 分，本来想着再写一篇关于 crash 处理的，好像时间有点晚了，还有日记要写，就留到明天吧。
