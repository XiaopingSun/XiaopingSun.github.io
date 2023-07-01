---
title: iOS 使用 OpenGLES 渲染相机预览画面
date: 2022-04-17 14:37:32
index_img: https://hexo.qiniu.pursue.top/opengl.jpeg
banner_img:
categories: 音视频开发
tags: [OpenGL, AVFoundation]
sticky:
---

# 前言

上一篇有提到 [使用 AVFoundation 采集相机画面](https://pursue.top/2022/04/07/%E4%BD%BF%E7%94%A8-AVFoundation-%E9%87%87%E9%9B%86%E7%9B%B8%E6%9C%BA%E7%94%BB%E9%9D%A2/)，并渲染到苹果内置的 AVCaptureVideoPreviewLayer 图层上，代码很简单，但使用上有很大局限性。AVCaptureSession 采集到的原始视频帧直接给到了 AVCaptureVideoPreviewLayer 用于渲染，我们没办法在中间环节处理视频帧数据，美颜滤镜也就没办法实现，所以我们需要借助 OpenGLES 自己实现画面渲染。

苹果的 GLKit 框架对 OpenGLES 的部分接口调用做了封装，使用起来非常方便。我们的需求可以直接使用 GLKView 实现，开发的代码量是比较少的，但为了熟悉 OpenGLES 的接口调用和管线渲染流程，我们还是使用最原始的方法，基于 CAEAGLLayer，自己来实现着色器代码。

# 代码实现

## 准备工作

### 使用 CAEAGLLayer

首先在项目中创建一个继承 UIView 的 XPGLKView，如果需要在图层上自定义 OpenGL 渲染，需要将 UIView 的 layerClass 设置为 CAEAGLLayer：

```objc
@implementation XPGLKView

+(Class)layerClass {
    return [CAEAGLLayer class];
}
```

### 顶点数据计算

我们需要计算两类坐标，一类是 OpenGL 顶点坐标，一类是纹理贴图的坐标，先定义一个结构体类型，包含两类坐标：

```objc
typedef struct {
    GLKVector2 positionCoordinates;
    GLKVector2 textureCoordinates;
} VerticesCoordinates;
```

我们的场景只需要 4 个顶点，使用  `glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);` 即可绘制两个三角形，按照顶点坐标和纹理坐标一一对应的关系，可以得到一个初步的顶点数据：

```objc
VerticesCoordinates vertices[] = {
    {{-1.0f, -1.0f}, {0.0f, 0.0f}}, // 左下
    {{ 1.0f, -1.0f}, {1.0f, 0.0f}}, // 右下
    {{-1.0f,  1.0f}, {0.0f, 1.0f}}, // 左上
    {{ 1.0f,  1.0f}, {1.0f, 1.0f}}  // 右上
};
```

上面看着没什么问题，但实际渲染发现图像上下颠倒了，原因是使用 CoreVideo 框架读取 Pixel Buffer 数据时是按照屏幕坐标原点（左上角）开始的，而纹理坐标正好相反，所以我们需要翻转一下纹理坐标的 Y 轴，得到最终的顶点数据：

```objc
VerticesCoordinates vertices[] = {
    {{-1.0f, -1.0f}, {0.0f, 1.0f}}, // 左下
    {{ 1.0f, -1.0f}, {1.0f, 1.0f}}, // 右下
    {{-1.0f,  1.0f}, {0.0f, 0.0f}}, // 左上
    {{ 1.0f,  1.0f}, {1.0f, 0.0f}}  // 右上
};
```

### 着色器程序

为了代码整洁，我们封装一个着色器程序，包含着色器的初始化、编译和链接功能：

```objc
// 初始化方法接受顶点着色器和片段着色器的代码字符串，创建着色器程序后，调用 compileShader 编译着色器，最后将着色器绑定在当前着色器程序上
- (instancetype)initWithVertexShaderString:(NSString *)vShaderString fragmentShaderString:(NSString *)fShaderString {
    self = [super init];
    if (self) {
        _attributes = [NSMutableArray array];
        _ID = glCreateProgram();
        
        if (![self compileShader:&_vertexShader type:GL_VERTEX_SHADER string:vShaderString]) {
            NSLog(@"Failed to compile vertex shader");
        }
        
        if (![self compileShader:&_fragmentShader type:GL_FRAGMENT_SHADER string:fShaderString]) {
            NSLog(@"Failed to compile fragment shader");
        }
        
        glAttachShader(_ID, _vertexShader);
        glAttachShader(_ID, _fragmentShader);
    }
    return self;
}

// 释放
- (void)dealloc {
    if (_vertexShader) {
        glDeleteShader(_vertexShader);
    }
    if (_fragmentShader) {
        glDeleteShader(_fragmentShader);
    }
    if (_ID) {
        glDeleteProgram(_ID);
    }
}

// 创建、编译着色器
- (BOOL)compileShader:(GLuint *)shader type:(GLenum)type string:(NSString *)shaderString {
    GLint status;
    const GLchar *source = (GLchar *)[shaderString UTF8String];
    if (!source) {
        NSLog(@"Failed to load shader string");
        return NO;
    }
    
  	// 创建着色器
    *shader = glCreateShader(type);
  	// 绑定着色器代码
    glShaderSource(*shader, 1, &source, NULL);
  	// 编译着色器
    glCompileShader(*shader);
    
  	// 检查着色器编译状态
    glGetShaderiv(*shader, GL_COMPILE_STATUS, &status);
    if (status != GL_TRUE) {
        GLint logLength;
        glGetShaderiv(*shader, GL_INFO_LOG_LENGTH, &logLength);
        if (logLength) {
            GLchar *log = (GLchar *)malloc(logLength);
            glGetShaderInfoLog(*shader, logLength, &logLength, log);
            if (shader == &_vertexShader) {
                self.vertexShaderLog = [NSString stringWithFormat:@"%s", log];
            } else {
                self.fragmentShaderLog = [NSString stringWithFormat:@"%s", log];
            }
            free(log);
        }
    }
    return status == GL_TRUE;
}

// 链接着色器
- (BOOL)link {
    GLint status;
    glLinkProgram(_ID);
    glGetProgramiv(_ID, GL_LINK_STATUS, &status);
    if (status == GL_FALSE) {
        return NO;
    }
    
    if (_vertexShader) {
        glDeleteShader(_vertexShader);
        _vertexShader = 0;
    }
    if (_fragmentShader) {
        glDeleteShader(_fragmentShader);
        _fragmentShader = 0;
    }
    return YES;
}

// 使用着色器程序
- (void)use {
    glUseProgram(_ID);
}

// 给顶点着色器属性绑定 location
- (void)addAttribute:(NSString *)attributeName {
    if (![_attributes containsObject:attributeName]) {
        [_attributes addObject:attributeName];
        glBindAttribLocation(_ID, (GLuint)[_attributes indexOfObject:attributeName], [attributeName UTF8String]);
    }
}

// 获取顶点着色器属性 location
- (GLuint)getAttributeLocation:(NSString *)attributeName {
    return (GLuint)[_attributes indexOfObject:attributeName];
}

// 获取 uniform 属性 localtion
- (GLuint)getUniformLocation:(NSString *)uniformName {
    return glGetUniformLocation(_ID, [uniformName UTF8String]);
}

// 打印错误信息
- (void)showError {
    NSString *progLog = [self programLog];
    NSLog(@"Program link log: %@", progLog);
    NSString *fragLog = [self fragmentShaderLog];
    NSLog(@"Fragment shader compile log: %@", fragLog);
    NSString *vertLog = [self vertexShaderLog];
    NSLog(@"Vertex shader compile log: %@", vertLog);
}
```

有了着色器程序，再来看下顶点着色器和片段着色器的代码：

```objc
// 顶点着色器
static NSString *XP_GLK_VSH = @" \
attribute vec4 position; \
attribute vec4 inputTextureCoordinate; \
varying vec2 textureCoordinate; \
\
void main() \
{ \
gl_Position = position; \
textureCoordinate = inputTextureCoordinate.xy; \
} \
";

// 顶点着色器有两个 attribute 的属性，position 是从顶点缓冲区获取的顶点坐标
// inputTextureCoordinate 则是纹理坐标，这两个属性的类型是 vec4，是一个四维的坐标
// 而我们创建的顶点、纹理坐标是二维的，opengl 会使用默认自动转成 vec4 类型
// textureCoordinate 是顶点着色器传递给片段着色器的属性，片段着色器使用 textureCoordinate 计算纹理颜色

// ************************************************************************

// 片段着色器
static NSString *XP_GLK_FSH = @" \
varying highp vec2 textureCoordinate; \
uniform sampler2D inputImageTexture; \
\
void main() \
{ \
gl_FragColor = texture2D(inputImageTexture, textureCoordinate); \
} \
";

// textureCoordinate 是从顶点着色器传过来的顶点坐标，inputImageTexture 是纹理采样器
// texture2D()方法计算纹理在该点的颜色值，输出给 gl_FragColor
// 纹理采样器需要在使用前先绑定到纹理单元，稍后代码会有提到
```

有了顶点数据和着色器程序，接下来看一下 XPGLKView 的初始化代码。

## 初始化

初始化方法中设置一些变量的默认值，主要还是配置 OpenGL 环境：

```objc
- (void)commonInit {
  	// 标志位用于控制后台停止渲染
    _needStopDisplay = NO;
    // 填充模式
    _fillMode = XPVideoFillModeAspectFill;
  	// 递归锁 用来控制 openGL 的 API 
    _renderLock = [[NSRecursiveLock alloc] init];
    
    // add observer
    [self addObservers];
    
    // layer
  	// 首先是拿到 UIView 上的 CAEAGLLayer 图层做一些设置，opaque 属性设置为 YES 可以提升渲染效率
  	// contentsScale 比例因子设置为屏幕的比例因子，是为了适配 Retina 这类高分辨率的屏幕
  	// drawableProperties 设置的两个 Key & Value，kEAGLDrawablePropertyRetainedBacking 设置为 NO 表示当前帧绘制后就清空其内容
  	// kEAGLDrawablePropertyColorFormat 设置为 kEAGLColorFormatRGBA8 设置 renderBuffer 按 32位存储
    CAEAGLLayer *layer = (CAEAGLLayer *)self.layer;
    layer.opaque = YES;
    layer.contentsScale = [[UIScreen mainScreen] scale];
    layer.drawableProperties = [NSDictionary dictionaryWithObjectsAndKeys:[NSNumber numberWithBool:NO], kEAGLDrawablePropertyRetainedBacking, kEAGLColorFormatRGBA8, kEAGLDrawablePropertyColorFormat, nil];
        
    // EAGLContext
  	// 创建 OpenGL 上下文，如果不支持 OpenGLES 3.0 则使用 2.0 版本，创建好后将上下文绑定到当前线程。
    if (!_context) {
        _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES3];
        if (!_context) {
            _context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES2];
        }
    }
    if (!_context || ![EAGLContext setCurrentContext:_context]) {
        NSLog(@"failed to setup EAGLContext");
    }
    
    // clear color - black
  	// 默认填充颜色 - 黑色
    _backgroundColor = GLKVector4Make(0.0f, 0.0f, 0.0f, 1.0f);
    
    // texture cache
  	// 创建纹理数据缓冲区，CVOpenGLESTextureRef 和 CVOpenGLESTextureCacheRef 来自 CoreVideo 框架
  	// 此例中用于将相机回调的 Pixel Buffer 转换成 OpenGL 的纹理缓存
    CVReturn ret = CVOpenGLESTextureCacheCreate(kCFAllocatorDefault, NULL, _context, NULL, &_textureCache);
    if (ret != kCVReturnSuccess) {
        NSLog(@"CVOpenGLESTextureCacheCreate: %d", ret);
    }
    
    // program
  	// 创建着色器程序，编译链接顶点着色器和片段着色器，并给顶端着色器绑定两个属性，顶点坐标和纹理坐标
    _program = [[XPGLKProgram alloc] initWithVertexShaderString:XP_GLK_VSH fragmentShaderString:XP_GLK_FSH];
    [_program addAttribute:@"position"];
    [_program addAttribute:@"inputTextureCoordinate"];
    if (![_program link]) {
        [_program showError];
        NSLog(@"Filter shader link failed");
        _program = nil;
    }
    
    // create FBO
  	// 创建帧缓存
    glGenFramebuffers(1, &_frameBuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, _frameBuffer);
    
  	// 创建颜色渲染缓存
    glGenRenderbuffers(1, &_renderBuffer);
    glBindRenderbuffer(GL_RENDERBUFFER, _renderBuffer);
    
  	// 借助 layer 给 renderBuffer 分配空间（像素点个数、每个像素点占多少位）
    [_context renderbufferStorage:GL_RENDERBUFFER fromDrawable:(CAEAGLLayer *)self.layer];
    
  	// 获取初始化后的 renderBuffer 宽高
    GLint backingWidth, backingHeight;
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_WIDTH, &backingWidth);
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_HEIGHT, &backingHeight);
    
  	// 如果是 0，直接销毁返回
    if (backingWidth == 0 || backingHeight == 0) {
        [self destroyFrameBuffer];
        return;
    }
    
  	// 记录下来，用于调整视口大小
    _viewportSize.width = (CGFloat)backingWidth;
    _viewportSize.height = (CGFloat)backingHeight;
    
  	// 将 renderBuffer 绑定到帧缓存的颜色缓冲区
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, _renderBuffer);
  	// 检查帧缓存状态
    GLuint framebufferStatus = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (framebufferStatus != GL_FRAMEBUFFER_COMPLETE) {
        NSLog(@"Fail setup GL framebuffer %d:%d", backingWidth, backingHeight);
    } else {
        NSLog(@"Success setup GL framebuffer %d:%d", backingWidth, backingHeight);
    }
    
    // create VBO
  	// 创建顶点数据缓存
    glGenBuffers(1, &_vertexBuffer);
    glBindBuffer(GL_ARRAY_BUFFER, _vertexBuffer);
    glBufferData(GL_ARRAY_BUFFER, sizeof(_vertices), _vertices, GL_DYNAMIC_DRAW);
    
    // attributes、uniforms
  	// 获取顶点着色器定义的属性的 location
    _positionAttribute = [_program getAttributeLocation:@"position"];
    _textureCoordinateAttribute = [_program getAttributeLocation:@"inputTextureCoordinate"];
  
  	// 获取片段着色器定义的纹理采样器的 location
    _inputTextureUniform = [_program getUniformLocation:@"inputImageTexture"];
    
  	// 打开顶点着色器属性
    glEnableVertexAttribArray(_positionAttribute);
    glEnableVertexAttribArray(_textureCoordinateAttribute);
}
```

首先通过 layer 配置帧缓冲区的一些属性，随后初始化并绑定上下文，创建我们封装过的着色器程序，创建帧缓存、顶点缓存，最后将顶点着色器属性打开。

## 渲染

初始化之后，就可以准备渲染画面了，渲染方法触发的时机是 AVCaptureSession 的相机数据帧回调，我们在回调里切换渲染线程，调用 displayPixelBuffer 方法：

```objc
#pragma mark - AVCaptureVideoDataOutputSampleBufferDelegate
- (void)captureOutput:(AVCaptureOutput *)captureOutput didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection {
    CVPixelBufferRef originPixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    XPDispatchSync(self.renderQueue, cameraSourceRenderQueueKey, ^{
        [self.previewView displayPixelBuffer:originPixelBuffer];
    });
}
```

渲染的方法实现：

```objc
- (void)displayPixelBuffer:(CVPixelBufferRef)pixelBuffer {
  	// 避免在当前上下文使用多线程调用 opengl 接口  这里用了递归锁
    [_renderLock lock];
    
    // check needStopDisplay
  	// 后台不渲染
    if (_needStopDisplay) {
        [_renderLock unlock];
        return;
    }
    
    // checkout eagl context
  	// 校验上下文
    if ([EAGLContext currentContext] != _context) {
        [EAGLContext setCurrentContext:_context];
    }
    
    // use program
  	// 使用着色器程序
    [_program use];
    
    // bind frame buffer
  	// 绑定帧缓冲  根据颜色渲染缓冲的 buffer 大小更新视口
    glBindFramebuffer(GL_FRAMEBUFFER, _frameBuffer);
    glViewport(0, 0, (GLint)_viewportSize.width, (GLint)_viewportSize.height);
    
    // clean cache
  	// 刷新深度缓冲、颜色缓冲
    glClearColor(_backgroundColor.r, _backgroundColor.g, _backgroundColor.b, _backgroundColor.a);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    
    // clean texture and texture cache
  	// 清理纹理缓冲
    if (_texture) {
        CFRelease(_texture);
        _texture = NULL;
    }
    CVOpenGLESTextureCacheFlush(_textureCache, 0);
    
    // create a CVOpenGLESTexture from the CVImageBuffer
  	// pixel buffer 转换成纹理数据
    size_t frameWidth = CVPixelBufferGetWidth(pixelBuffer);
    size_t frameHeight = CVPixelBufferGetHeight(pixelBuffer);
    CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  	// 相当于 glTexImage2D()
    CVReturn ret = CVOpenGLESTextureCacheCreateTextureFromImage(kCFAllocatorDefault,
                                                                _textureCache,
                                                                pixelBuffer,
                                                                NULL,
                                                                GL_TEXTURE_2D,
                                                                GL_RGBA,  // 颜色分量数量
                                                                (GLsizei)frameWidth,
                                                                (GLsizei)frameHeight,
                                                                GL_BGRA,  // 像素数据格式
                                                                GL_UNSIGNED_BYTE,
                                                                0,
                                                                &_texture);
    if (!_texture || ret != kCVReturnSuccess) {
        NSLog(@"error: Mapping texture:%d", ret);
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    
    // handle texture
  	// 激活纹理单元（一般 GL_TEXTURE0 这个纹理单元默认会被激活，不需要手动调用）
    glActiveTexture(GL_TEXTURE0);
  	// 将刚生成的纹理到纹理缓冲区
    glBindTexture(CVOpenGLESTextureGetTarget(_texture), CVOpenGLESTextureGetName(_texture));
  	// 配置纹理参数
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  	// 将纹理单元 0 绑定到片段着色器的 inputImageTexture 纹理采样器
    glUniform1i(_inputTextureUniform, 0);
    
    // update vertices
  	// 通过比对当前帧的宽高和前一帧的宽高，决定是否需要更新顶点坐标
    [self updateInputImageSize:CGSizeMake(frameWidth, frameHeight)];
    
    // bind vertex buffer and handle vertex shader attribute pointer
  	// 绑定顶点缓冲
    glBindBuffer(GL_ARRAY_BUFFER, _vertexBuffer);
  	// 告知顶点着色器如何解析顶点数据，即先解析两个 float 给 position 属性，再解析两个 float 给inputTextureCoordinate 属性。
    glVertexAttribPointer(_positionAttribute, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, positionCoordinates));
    glVertexAttribPointer(_textureCoordinateAttribute, 2, GL_FLOAT, GL_FALSE, sizeof(VerticesCoordinates), (void *)offsetof(VerticesCoordinates, textureCoordinates));
    
    // draw two triangle with 4 vertices
  	// 根据给的 4 个顶点绘制两个三角形
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    
  	// 绑定 renderBuffer 并提交给 Core Animation
    glBindRenderbuffer(GL_RENDERBUFFER, _renderBuffer);
    [_context presentRenderbuffer:GL_RENDERBUFFER];
    
    [_renderLock unlock];
}
```

## 适配填充模式

按目前的顶点和纹理坐标，渲染内容默认会铺满整个图层，如果相机回调的 Pixel Buffer 宽高与图层宽高不一致，会产生拉伸的现象，因此需要适配不同的填充模式，我们定义了三种填充模式：

```objc
typedef NS_ENUM(NSUInteger, XPVideoFillMode) {
    XPVideoFillModeStretch,   // 拉伸以填满屏幕
    XPVideoFillModeAspectFit, // 保持宽高比，长边铺满屏幕，短边填充黑边
    XPVideoFillModeAspectFill,// 保持宽高比，短边铺满屏幕，长边裁剪
};
```

每种填充模式的顶点坐标计算方式：

```objc
- (void)recalculateVerticesCoordinates {
  	// 当前图层尺寸
    CGSize currentViewSize = _currentBoundsSize;
    CGRect currentViewBounds = CGRectMake(0, 0, currentViewSize.width, currentViewSize.height);
  	// 计算视频帧以 AspectRatio 方式填充在当前图层时，视频帧的 frame
    CGRect insetRect = AVMakeRectWithAspectRatioInsideRect(_inputImageSize, currentViewBounds);
    
    CGFloat heightScaling, widthScaling;
    switch (_fillMode) {
        case XPVideoFillModeStretch:
            widthScaling = 1.0f;
            heightScaling = 1.0f;
            break;
            
        case XPVideoFillModeAspectFit:
            widthScaling = insetRect.size.width / currentViewSize.width;
            heightScaling = insetRect.size.height / currentViewSize.height;
            break;
            
        case XPVideoFillModeAspectFill: {
            widthScaling = currentViewSize.height / insetRect.size.height;
            heightScaling = currentViewSize.width / insetRect.size.width;
        }
            break;
            
        default:
            break;
    }
    
  	// 顶点坐标
    _vertices[0].positionCoordinates = GLKVector2Make(-widthScaling, -heightScaling);
    _vertices[1].positionCoordinates = GLKVector2Make(widthScaling, -heightScaling);
    _vertices[2].positionCoordinates = GLKVector2Make(-widthScaling, heightScaling);
    _vertices[3].positionCoordinates = GLKVector2Make(widthScaling, heightScaling);

  	// 纹理坐标
    _vertices[0].textureCoordinates = GLKVector2Make(0.0f, 1.0f);
    _vertices[1].textureCoordinates = GLKVector2Make(1.0f, 1.0f);
    _vertices[2].textureCoordinates = GLKVector2Make(0.0f, 0.0f);
    _vertices[3].textureCoordinates = GLKVector2Make(1.0f, 0.0f);
}
```

在渲染过程中，将顶点数据更新同步到 GPU：

```objc
glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(_vertices), _vertices);
```

# 后记

相机画面的自定义渲染没有用到 OpenGL 的高级功能，主要是对 OpenGL 对象、纹理、管线概念的理解，和 Core Animation、Core Video 的交互。下面贴一些文档可以用来参考：

> 1.OpenGL 中文手册 https://learnopengl-cn.github.io/
>
> 2.iOS 核心动画高级技巧 https://zsisme.gitbooks.io/ios-/content/index.html
>
> 3.OpenGLES 苹果官网文档 https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Introduction/Introduction.html#//apple_ref/doc/uid/TP40008793-CH1-SW1
>
> 4.《OpenGL ES应用开发实践 指南 iOS卷》
