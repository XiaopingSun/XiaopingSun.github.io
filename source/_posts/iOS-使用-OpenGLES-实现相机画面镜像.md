---
title: iOS 使用 OpenGLES 实现相机画面镜像
date: 2022-04-19 12:02:00
index_img: https://hexo.qiniu.pursue.top/opengl.jpeg
banner_img:
categories: 音视频开发
tags: OpenGL
sticky:
---

# 前言

上一篇 [使用 OpenGLES 渲染相机预览画面](https://pursue.top/2022/04/17/iOS-%E4%BD%BF%E7%94%A8-OpenGLES-%E6%B8%B2%E6%9F%93%E7%9B%B8%E6%9C%BA%E9%A2%84%E8%A7%88%E7%94%BB%E9%9D%A2/) 实现了自定义相机画面渲染，使用自定义的图层替代了 AVFoundation 默认渲染图层，但还需要考虑的是预览和编码镜像的问题。由于现在图层使用的 Buffer 数据来自 AVCaptureVideoDataOutput ，我们可以通过设置 AVCaptureVideoDataOutput 链接的 AVCaptureConnection 的  videoMirrored 属性，并关闭 automaticallyAdjustsVideoMirroring 去统一调整预览和编码的镜像，但有些场景需要预览镜像编码不镜像，或预览不镜像编码镜像，所以就需要一个工具类去处理预览和编码镜像不一致的场景。

# 实现思路

大批量的像素翻转不适合在 CPU 上处理，因此考虑使用 OpenGL 的离屏渲染，将输出纹理绑定在帧缓冲区的颜色缓冲，在输入纹理绑定上下文后，通过翻转顶点着色器 gl_Position 的 X 坐标实现纹理镜像。

# 代码

首先是顶点坐标的计算，自定义一个 VerticesCoordinates，positionCoordinates 表示顶点坐标，textureCoordinates 表示纹理坐标，vertices 中的 4 个坐标分别是矩形的 4 个顶点，这里跟上一篇的顶点坐标有点不同，上一篇的顶点坐标用于屏幕渲染，会有纹理原点和屏幕原点不一致的情况，所以纹理坐标的 Y 做了翻转，我们这次的输出也是纹理，所以不需要做翻转，一一对应就可以。我们绘制用的是 `glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);`，即 4 个顶点绘制 2 个三角形。

```objc
typedef struct {
    GLKVector2 positionCoordinates;
    GLKVector2 textureCoordinates;
} VerticesCoordinates;

// vertices
VerticesCoordinates vertices[] = {
    {{-1.0f, -1.0f}, {0.0f, 0.0f}}, // 左下
    {{ 1.0f, -1.0f}, {1.0f, 0.0f}}, // 右下
    {{-1.0f,  1.0f}, {0.0f, 1.0f}}, // 左上
    {{ 1.0f,  1.0f}, {1.0f, 1.0f}}  // 右上
};
```

为了方便，顶点着色器和片段着色器保存在字符串里。顶点着色器定义两个 attribute 属性用来读取顶点坐标和纹理坐标，v_texcoord 属性将纹理坐标传递给片段着色器，在 main 函数里，将 gl_Position 的 X 坐标做了翻转来实现镜像效果。片段着色器先声明了 float 使用中等精度，v_texcoord 与顶点着色器对应，tex 声明一个纹理采样器，最后在 main 函数里使用纹理采样器计算出像素颜色。

```objc
// vertex shader
static const char* vertex_shader_string =
"attribute vec2 position;"
"attribute vec2 texcoord;"
"varying vec2 v_texcoord;"
"void main() {"
"   gl_Position = vec4(-position.x, position.y, 0.0, 1.0);"
"   v_texcoord = texcoord;"
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

着色器的创建、编译和链接，着色器程序的生成代码：

```objc
static inline GLuint compile_shader(GLuint type, const char* source) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint compiled;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);

#ifdef DEBUG
    if (!compiled) {
        GLint length;
        char* log;
        
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
                
        log = (char *)malloc(length);
        glGetShaderInfoLog(shader, length, &length, &log[0]);
        DLog("%s compilation error: %s\n", (type == GL_VERTEX_SHADER ? "GL_VERTEX_SHADER" : "GL_FRAGMENT_SHADER"), log);
        free(log);
        
        return 0;
    }
#endif
    
    return shader;
}

static inline GLuint build_program(const char* vertex_shader_string, const char* fragment_shader_string) {
    GLuint vshad, fshad, p;
    GLint len;
    
#ifdef DEBUG
    char* log;
#endif
    
    vshad = compile_shader(GL_VERTEX_SHADER, vertex_shader_string);
    fshad = compile_shader(GL_FRAGMENT_SHADER, fragment_shader_string);
    
    p = glCreateProgram();
    glAttachShader(p, vshad);
    glAttachShader(p, fshad);
    glLinkProgram(p);
    glGetProgramiv(p, GL_INFO_LOG_LENGTH, &len);
    
#ifdef DEBUG
    if (len) {
        log = (char *)malloc(len);
        glGetProgramInfoLog(p, len, &len, log);
        DLog("program log: %s\n", log);
        free(log);
    }
#endif
    
    glDeleteShader(vshad);
    glDeleteShader(fshad);
    return p;
}
```

着色器和顶点坐标准备完成后，可以初始化 OpenGL 环境了：

```objc
- (void)setupGL {
    // eagl context  创建 opengl 上下文
    _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES3];
    if (!_context) {
        _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES2];
        if (!_context) {
            NSLog(@"error: video mirror processor, Error! Unable to create an OpenGL ES Context!");
        }
    }
  	// 绑定当前线程
    if (!_context || ![EAGLContext setCurrentContext:_context]) {
        NSLog(@"failed to setup EAGLContext");
    }
    
    // texture cache  用于缓存输入输出的纹理数据
    CVReturn ret = CVOpenGLESTextureCacheCreate(kCFAllocatorDefault, NULL, _context, NULL, &_textureCache);
    if (ret != kCVReturnSuccess) {
        NSLog(@"error: video mirror processor, Error! CVOpenGLESTextureCacheCreate failed %d", ret);
    }
    
    // vbo   顶点坐标缓冲
    glGenBuffers(1, &_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, _vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
    
    // shader program   编译着色器程序
    _program = build_program(vertex_shader_string, fragment_shader_string);
    glUseProgram(_program);
    
    // setup fragment shader texture sampler
  	// 拿到片段着色器里纹理采样器的 location，绑定 GL_TEXTURE0 的纹理单元
    GLint samplerLocation = glGetUniformLocation(_program, "tex");
    glUniform1f(samplerLocation, 0);
    
    // setup vertex shader attributes
  	// 拿到顶点着色器里两个坐标属性的 location，打开属性开关，指定顶点坐标解析规则
    GLint posLocation = glGetAttribLocation(_program, "position");
    GLint texLocation = glGetAttribLocation(_program, "texcoord");
    glEnableVertexAttribArray(posLocation);
    glEnableVertexAttribArray(texLocation);
    glVertexAttribPointer(posLocation, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, positionCoordinates));
    glVertexAttribPointer(texLocation, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, textureCoordinates));
}
```

由于帧缓冲区输出的纹理依赖输入的 Pixel Buffer 的宽高，所以 fbo 和输出纹理放到 process 方法里动态创建。在初始化 OpenGL 环境后，就可以调用 process 来渲染了：

```objc
- (CVPixelBufferRef)process:(CVPixelBufferRef)pixelBuffer {
  	// 避免多线程调用  
    [_renderLock lock];
    
  	// 如果是后台  停止渲染
    if (_needStopDisplay) {
        [_renderLock unlock];
        return _outputPixelBuffer;
    }
    
  	// 绑定当前线程上下文
    if ([EAGLContext currentContext] != _context) {
        [EAGLContext setCurrentContext:_context];
    }
    
  	// 拿到输入纹理宽高
    GLsizei pixelWidth = (GLsizei)CVPixelBufferGetWidth(pixelBuffer);
    GLsizei pixelHeight = (GLsizei)CVPixelBufferGetHeight(pixelBuffer);
    
  	// 如果宽高是 0 直接返回
    if (pixelWidth == 0 || pixelHeight == 0) {
        [_renderLock unlock];
        return _outputPixelBuffer;
    }
    
  	// _currentRenderSize 用来记录上次渲染的宽高，如果输入纹理宽高与 _currentRenderSize 不一致，需要重新分配输出 Buffer 并重新初始化 FBO
    if (pixelWidth != _currentRenderSize.width || pixelHeight != _currentRenderSize.height) {
        _currentRenderSize = CGSizeMake(pixelWidth, pixelHeight);
        [self setupCVPixelBuffer:&_outputPixelBuffer];
        _needUpdateFBO = YES;
    }
    
  	// 输入纹理宽高发生变化，或 App 返回前台，重新初始化 FBO
    if (_needUpdateFBO) {
        [self setupFBO];
        _needUpdateFBO = NO;
    }
    
  	// 释放输入纹理，清空输入纹理缓存
    if (_inputTexture) {
        CFRelease(_inputTexture);
        _inputTexture = NULL;
    }
    CVOpenGLESTextureCacheFlush(_textureCache, 0);
    
  	// 从 Pixel Buffer 读数据前，需要先上锁
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
    
  	// 绑定输入纹理，设置纹理参数
    glBindTexture(CVOpenGLESTextureGetTarget(_inputTexture), CVOpenGLESTextureGetName(_inputTexture));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    
  	// 激活着色器程序，绑定 FBO、VBO
    glUseProgram(_program);
    glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
    glBindBuffer(GL_ARRAY_BUFFER, _vbo);
    
  	// 清空帧缓冲区颜色缓冲
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    
  	// 调整视口大小
    glViewport(0, 0, _currentRenderSize.width, _currentRenderSize.height);
  
  	// 用 4 个顶点绘制 2 个三角形
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    
  	// flush OpenGL 队列
    glFlush();
  
  	// 绑定默认帧缓冲
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    
    [_renderLock unlock];
    return _outputPixelBuffer;
}
```

27 行位置判断当前输入的 Pixel Buffer 宽高是否与上一次渲染的宽高一致，如果不一致会重新创建输出的 Pixel Buffer：

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

随后会重新初始化帧缓冲区和输出纹理：

```objc
- (void)setupFBO {
  	// 绑定当前线程上下文
    if ([EAGLContext currentContext] != _context) {
        [EAGLContext setCurrentContext:_context];
    }
        
  	// 清空 FBO
    if (_fbo > 0) {
        glDeleteFramebuffers(1, &_fbo);
        _fbo = 0;
    }
    
  	// 创建 FBO
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
    	
  	// 绑定输出纹理到纹理缓冲区，设置纹理参数
    glBindTexture(CVOpenGLESTextureGetTarget(_outputTexture), CVOpenGLESTextureGetName(_outputTexture));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    
  	// 绑定帧缓冲
    glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
  	// 将输出纹理绑定到帧缓冲的颜色缓冲
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, CVOpenGLESTextureGetName(_outputTexture), 0);
    if(glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        NSLog(@"error: failed to make complete framebuffer object %x", glCheckFramebufferStatus(GL_FRAMEBUFFER));
    }
    
  	// 绑定默认帧缓冲
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}
```

setupFBO 创建了帧缓冲，并将输出纹理绑定到帧缓冲的颜色缓冲上，处理完成后将 _outputPixelBuffer 返回给调用者。

另外还有一些前后台的处理：

```objc
- (void)handleApplicationDidEnterBackground:(NSNotification *)notification {
    [_renderLock lock];
    _needStopDisplay = YES;
  	// 主要是清空纹理缓存和 FBO
    [self destroyGL];
    glFinish();
    [_renderLock unlock];
}

- (void)handleApplicationDidBecomeActive:(NSNotification *)notification {
    [_renderLock lock];
    _needStopDisplay = NO;
    if (!_fbo) {
        _needUpdateFBO = YES;
    }
    [_renderLock unlock];
}
```

# 后记

代码完成后，就可以在 didOutputSampleBuffer 回调里使用了，这样，前后置预览镜像和编码镜像就都可以单独配置了，镜像后的数据可以输入到下一级的 processor 中做处理，最终吐给编码器编码。
