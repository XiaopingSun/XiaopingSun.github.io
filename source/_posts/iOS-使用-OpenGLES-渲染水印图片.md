---
title: iOS 使用 OpenGLES 渲染水印图片
date: 2022-04-19 16:33:16
index_img: https://hexo.qiniu.pursue.show/opengl.jpeg
banner_img: 
categories: 音视频开发
tags: OpenGL
sticky:
---

# 前言

这次我们用 OpenGLES 将水印、贴图渲染到相机的预览画面上，代码跟上一篇 [iOS 使用 OpenGLES 实现相机画面镜像](https://pursue.show/2022/04/19/iOS-%E4%BD%BF%E7%94%A8-OpenGLES-%E5%AE%9E%E7%8E%B0%E7%9B%B8%E6%9C%BA%E7%94%BB%E9%9D%A2%E9%95%9C%E5%83%8F/) 差不多。

# 实现思路

输入的纹理应该有两路，一路是相机回调的 Pixel Buffer，一路是水印图片纹理。相机 Buffer 在视口中的大小始终是不变的，但水印图片 Size 和 Position 都是不固定的，不能使用相同的顶点坐标和视口大小绘制这两个纹理，目前想到的有两种方式可以实现：一种是两个纹理采用两个不同的顶点坐标，同时共享屏幕视口大小；一种是两个纹理采用同一组顶点坐标，采用不同的视口大小。此例采用第二种方式。

# 代码

顶点坐标还是与上一篇的一致，由于是将渲染结果输出到纹理，因此不需要做翻转，顶点坐标纹理坐标一一对应即可：

```objc
typedef struct {
    GLKVector2 positionCoordinates;
    GLKVector2 textureCoordinates;
} VerticesCoordinates;

// vertices
static const VerticesCoordinates vertices[] = {
    {{-1.0f, -1.0f}, {0.0f, 0.0f}}, // 左下
    {{ 1.0f, -1.0f}, {1.0f, 0.0f}}, // 右下
    {{-1.0f,  1.0f}, {0.0f, 1.0f}}, // 左上
    {{ 1.0f,  1.0f}, {1.0f, 1.0f}}  // 右上
};
```

然后是着色器们，顶点着色器接受顶点坐标和纹理坐标转成 vec4 类型，赋值给 gl_Position，并将纹理坐标给到片段着色器。片段着色器拿到纹理坐标，通过纹理采样器计算像素颜色：

```objc
// vertex shader
static const char* vertex_shader_string =
"attribute vec4 position;"
"attribute vec4 texcoord;"
"varying vec2 v_texcoord;"
"void main() {"
"   gl_Position = position;"
"   v_texcoord = texcoord.xy;"
"}";

// fragment shader
static const char* fragment_shader_string =
"precision mediump float;"
"varying vec2 v_texcoord;"
"uniform sampler2D tex;"
"void main() {"
"   gl_FragColor = texture2D(tex, v_texcoord);"
"}";
```

着色器程序的创建、编译代码跟上一篇一致，就不再贴了，接着看下初始化方法：

```objc
- (void)setupGL {
    // eagl context  创建、绑定上下文
    _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES3];
    if (!_context) {
        _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES2];
        if (!_context) {
            NSLog(@"error: video mirror processor, Error! Unable to create an OpenGL ES Context!");
        }
    }
    if (!_context || ![EAGLContext setCurrentContext:_context]) {
        NSLog(@"failed to setup EAGLContext");
    }
        
    // texture cache   创建输入输出纹理缓冲区
    CVReturn ret = CVOpenGLESTextureCacheCreate(kCFAllocatorDefault, NULL, _context, NULL, &_textureCache);
    if (ret != kCVReturnSuccess) {
        NSLog(@"error: video mirror processor, Error! CVOpenGLESTextureCacheCreate failed %d", ret);
    }
        
    // enable blend  打开 OpenGL 混合模式  用于纹理叠加
    glEnable(GL_BLEND);
  
  	// 用来设置源纹理和目标纹理的混合模式  此例中源纹理指水印图片  目标纹理指相机 Buffer
  	// 第一个参数是源因子  设置为 GL_ONE 表示当源纹理在某像素上 alpha 不为 0 时  则该像素完全使用源纹理
  	// 第二个参数是目标因子 设置为 GL_ONE_MINUS_SRC_ALPHA 表示在源纹理 alpha 为 0 的像素点使用目标纹理
  	// 如果第二个参数使用 GL_ZERO 完全关闭目标纹理通道，在源纹理 alpha 为 0 的位置会显示底色（黑色）
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        
    // vbo  创建顶点缓冲
    glGenBuffers(1, &_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, _vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
        
    // shader program  创建着色器程序并激活
    _program = build_program(vertex_shader_string, fragment_shader_string);
    glUseProgram(_program);
            
    // setup fragment shader texture sampler
  	// 获取片段着色器中纹理采样器的 location 并绑定 GL_TEXTURE0
    GLint samplerLocation = glGetUniformLocation(_program, "tex");
    glUniform1i(samplerLocation, 0);
            
    // setup vertex shader attributes
  	// 获取顶点着色器两个属性的 Location，打开顶点属性，设置顶点坐标纹理坐标的解析方式
    GLint posLocation = glGetAttribLocation(_program, "position");
    GLint texLocation = glGetAttribLocation(_program, "texcoord");
    glEnableVertexAttribArray(posLocation);
    glEnableVertexAttribArray(texLocation);
    glVertexAttribPointer(posLocation, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, positionCoordinates));
    glVertexAttribPointer(texLocation, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, textureCoordinates));
}
```

两个纹理混合需要将 GL_BLEND 打开，通过 glBlendFunc 设置源因子和目标因子，不同的参数设置会产生不同的纹理叠加效果。FBO 和水印纹理的创建是动态的，所以放到渲染循环里处理：

```objc
- (CVPixelBufferRef)process:(CVPixelBufferRef)pixelBuffer {
  	// 避免多线程调用
    [_renderLock lock];
    
  	// 这里检查是否是后台、水印图片是否存在
    if (_needStopDisplay || !_watermarkImage) {
        [_renderLock unlock];
        return _outputPixelBuffer;
    }
    
  	// 绑定上下文
    if ([EAGLContext currentContext] != _context) {
        [EAGLContext setCurrentContext:_context];
    }
        
  	// 获取相机 Buffer 宽高
    GLsizei pixelWidth = (GLsizei)CVPixelBufferGetWidth(pixelBuffer);
    GLsizei pixelHeight = (GLsizei)CVPixelBufferGetHeight(pixelBuffer);
    
  	// 宽高为 0 返回
    if (pixelWidth == 0 || pixelHeight == 0) {
        [_renderLock unlock];
        return _outputPixelBuffer;
    }
    
  	// 与上一次渲染的 Size 做对比，如果不一致需要重新创建输出 Buffer 和 FBO
    if (pixelWidth != _currentRenderSize.width || pixelHeight != _currentRenderSize.height) {
        _currentRenderSize = CGSizeMake(pixelWidth, pixelHeight);
        [self setupCVPixelBuffer:&_outputPixelBuffer];
        _needUpdateFBO = YES;
    }
        
  	// 创建 FBO
    if (_needUpdateFBO) {
        [self setupFBO];
        _needUpdateFBO = NO;
    }
        
  	// 每次有图片传进来  会触发一次 setupWatermarkTexture 创建水印纹理
    if (_needUpdateWatermark) {
        [self setupWatermarkTexture];
        _needUpdateWatermark = NO;
    }
    
  	// 清空输入纹理、输入纹理缓存
    if (_inputTexture) {
        CFRelease(_inputTexture);
        _inputTexture = NULL;
    }
    CVOpenGLESTextureCacheFlush(_textureCache, 0);
    
  	// 创建相机 Buffer 纹理
    CVPixelBufferLockBaseAddress(pixelBuffer, 0);
    CVReturn ret = CVOpenGLESTextureCacheCreateTextureFromImage(kCFAllocatorDefault,
                                                                _textureCache,
                                                                pixelBuffer,
                                                                NULL,
                                                                GL_TEXTURE_2D,
                                                                GL_RGBA,
                                                                pixelWidth,
                                                                pixelHeight,
                                                                GL_BGRA,
                                                                GL_UNSIGNED_BYTE,
                                                                0,
                                                                &_inputTexture);
    if (ret != kCVReturnSuccess) {
        NSLog(@"error: _inTexture, CVOpenGLESTextureCacheCreateTextureFromImage, failed.");
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    
  	// 绑定相机 Buffer 纹理，设置纹理参数
    glBindTexture(CVOpenGLESTextureGetTarget(_inputTexture), CVOpenGLESTextureGetName(_inputTexture));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    
  	// 激活着色器程序，绑定 FBO、VBO
    glUseProgram(_program);
    glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
    glBindBuffer(GL_ARRAY_BUFFER, _vbo);
    
  	// 清空帧缓存区颜色缓冲
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    
  	// 调整视口大小为 Buffer 宽高，绘制相机 Buffer 纹理
    glViewport(0, 0, _currentRenderSize.width, _currentRenderSize.height);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    
  	// 绑定水印图片纹理
    glBindTexture(GL_TEXTURE_2D, _watermarkTexture);
  
  	// 调整视口大小为传入的水印 Position 和 Size，绘制水印图片纹理
    glViewport(_watermarkPosition.x, _watermarkPosition.y, _watermarkSize.width, _watermarkSize.height);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    
  	// 刷新 OpenGL 队列
    glFlush();
  
  	// 绑定默认帧缓存
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    
    [_renderLock unlock];
    return _outputPixelBuffer;
}
```

process 方法实际是有两次绘制，先是渲染了相机 Buffer，然后调整视口大小为水印的 position 和 size，再渲染水印纹理。

创建输出 Buffer 代码：

```objc
- (void)setupCVPixelBuffer:(CVPixelBufferRef *)pixelBuffer {
    NSDictionary *pixelBufferOptions = @{ (NSString *)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
                                          (NSString *)kCVPixelBufferWidthKey : @(_currentRenderSize.width),
                                          (NSString *)kCVPixelBufferHeightKey : @(_currentRenderSize.height),
                                          (NSString *)kCVPixelBufferOpenGLESCompatibilityKey : @YES,
                                          (NSString *)kCVPixelBufferIOSurfacePropertiesKey : @{} };
    if (*pixelBuffer) {
        CVPixelBufferRelease(*pixelBuffer);
        *pixelBuffer = NULL;
    }
    CVReturn ret = CVPixelBufferCreate(kCFAllocatorDefault,
                                       _currentRenderSize.width,
                                       _currentRenderSize.height,
                                       kCVPixelFormatType_32BGRA,
                                       (__bridge  CFDictionaryRef)pixelBufferOptions,
                                       pixelBuffer);
    if (ret != kCVReturnSuccess) {
        NSLog(@"error: video mirror processor, Unable to create cvpixelbuffer %d", ret);
    }
}
```

创建 FBO 代码：

```objc
- (void)setupFBO {
  	// 绑定上下文
    if ([EAGLContext currentContext] != _context) {
        [EAGLContext setCurrentContext:_context];
    }
        	
  	// 释放帧缓存
    if (_fbo > 0) {
        glDeleteFramebuffers(1, &_fbo);
        _fbo = 0;
    }
    
  	// 创建帧缓存
    glGenFramebuffers(1, &_fbo);
    
  	// 释放输出纹理
    if (_outputTexture) {
        CFRelease(_outputTexture);
        _outputTexture = NULL;
    }
    
  	// 创建输出纹理
    CVReturn ret = CVOpenGLESTextureCacheCreateTextureFromImage(kCFAllocatorDefault,
                                                                _textureCache,
                                                                _outputPixelBuffer,
                                                                NULL,
                                                                GL_TEXTURE_2D,
                                                                GL_RGBA,
                                                                _currentRenderSize.width,
                                                                _currentRenderSize.height,
                                                                GL_BGRA,
                                                                GL_UNSIGNED_BYTE,
                                                                0,
                                                                &_outputTexture);
    if (ret != kCVReturnSuccess) {
        NSLog(@"error: _outputTexture, CVOpenGLESTextureCacheCreateTextureFromImage, failed.");
    }
    
  	// 绑定输出纹理，设置纹理参数
    glBindTexture(CVOpenGLESTextureGetTarget(_outputTexture), CVOpenGLESTextureGetName(_outputTexture));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    
  	// 绑定帧缓存
    glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
  	// 将输出纹理绑定到帧缓存的颜色缓存
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, CVOpenGLESTextureGetName(_outputTexture), 0);
    if(glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        NSLog(@"error: failed to make complete framebuffer object %x", glCheckFramebufferStatus(GL_FRAMEBUFFER));
    }
    
  	// 绑定默认帧缓存
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}
```

创建水印图片纹理代码：

```objc
- (void)setupWatermarkTexture {
  	// 判断图片文件的 Size 和传入的 watermarkSize 是否一致，不一致先将图片做缩放
    if (!CGSizeEqualToSize(_watermarkImage.size, _watermarkSize)) {
        // scale image
        UIGraphicsBeginImageContext(_watermarkSize);
        [_watermarkImage drawInRect:CGRectMake(0, 0, _watermarkSize.width, _watermarkSize.height)];
        UIImage *scaledImage = UIGraphicsGetImageFromCurrentImageContext();
        UIGraphicsEndImageContext();
        _watermarkImage = scaledImage;
    }
    
  	// 释放水印纹理缓冲
    if (_watermarkTexture) {
        glDeleteTextures(1, &_watermarkTexture);
        _watermarkTexture = 0;
    }
    
  	// 使用 GLKit 将 CGImageRef 转成纹理对象
    NSError *error;
    GLKTextureInfo *textureInfo = [GLKTextureLoader textureWithCGImage:_watermarkImage.CGImage options:nil error:&error];
    if (error) {
        NSLog(@"error: create watermark texture failed: %@", error.localizedDescription);
    }
    
  	// 绑定水印纹理缓冲，设置纹理参数
    glBindTexture(textureInfo.target, textureInfo.name);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    
  	// 保存纹理对象索引
    _watermarkTexture = textureInfo.name;
}
```

这里使用 GLKTextureLoader 生成纹理对象时发现一个问题，_watermarkImage.CGImage 明明有值但 textureWithCGImage 方法一直在报错，报错信息是 `The operation couldn’t be completed. (GLKTextureLoaderErrorDomain error 8.)` 。通过在每行 OpenGL 代码后增加 `NSLog(@"GL Error = %u", glGetError());` 打印错误信息，发现是在给片段着色器的纹理采样器绑定纹理单元时方法用错了 glUniform1i 写成了 glUniform1f，修改之后运行没有问题，也算了解了一种 OpenGL 报错的排查方式。

# 后记

代码完成后就可以放到相机的回调方法里使用了。最近一直在看 OpenGLES 的代码，目前工程里还有一些相关的工具需要写，比如像素格式转换，Buffer 裁剪的功能，之后也会总结到博客上。哇今天还是比较高产，写了两篇博客，晚上可以加个鸡腿了，疫情期间鸡腿可是奢侈品呐。。。
