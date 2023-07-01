---
title: iOS 实现简单的异常捕获和堆栈解析
date: 2022-08-07 13:09:40
index_img: https://hexo.qiniu.pursue.top/xcode_banner.png
banner_img:
categories: iOS
tags: 异常捕获
sticky:
---

# 前言

这两周的一个需求，给引擎添加 crash 捕获和上传功能。如果正常一个 iOS App 需要添加 crash 捕获，一般会接入 Bugly 这种一体化 crash 分析平台，或者如果有自己的后台来搜集 crash 日志，也可以使用 KSCrash 或 PLCrashReporter 来实现崩溃日志的捕获。但本身作为一个引擎 SDK 来说，还是要尽可能少的接入三方库，即使是开源的。好在需求仅要求记录崩溃的大体堆栈信息，地址可解析即可，不需要太复杂的逻辑。

# Crash 的分类和处理顺序

根据 Crash 的不同来源，一般分为 Mach 异常、Unix 信号 和 NSException。Mach 异常也称内核级异常，可以通过创建监控线程的方式监听 Mach 异常并处理异常信息，如果开发者没有捕获 Mach 异常，则异常将被转换为对应的 Unix 信号投递到出错线程。NSException 也称为应用级异常，可以通过 try catch 来捕获，也可以通过 NSSetUncaughtExceptionHandler 机制来捕获，最终未被处理的 NSException 会向自身程序发送 SIGABRT 信号使程序崩溃。三种异常处理的顺序可以参考这张图：

![异常处理的顺序](https://hexo.qiniu.pursue.top/5219632-04e43775dfba56f8.webp)

# 实现方式

Mach 异常 和 Unix 信号由于来源都是底层内核级异常，只是回调方式不同，因此在项目中选择监听 Unix 信号。应用级异常 NSException 是需要监听的，捕获的 exception 中有对排查问题很有帮助的 reason 信息，需要将这部分信息保存起来，再将 crash 信息传递给 Mach 和 Unix 层来捕获。

# 代码

## 捕获 NSException

```objc
void IPhoneCrashHandler::initNSExceptionHandler() {
    if (sPreviousUncaughtExceptionHandler == nullptr) {
        // hold origin handler
        sPreviousUncaughtExceptionHandler = NSGetUncaughtExceptionHandler();
    }
    // setup new handler
    NSSetUncaughtExceptionHandler(&uncaughtNSExceptionHandler);
}
```

初始化监听只需要调用 `NSSetUncaughtExceptionHandler` 传入回调函数指针即可，函数签名是 `typedef void NSUncaughtExceptionHandler(NSException *exception);` ，需要注意的是这个回调函数在 App 生命周期是唯一的，也就是说如果 App 有其他 crash 捕获模块，可能会有冲突。为了避免多个 crash 捕获失效的问题，需要先调用 `NSGetUncaughtExceptionHandler` 函数保存前任的函数指针，并在处理完 exception 之后主动调用这个函数传递 exception。

```objc
static void uncaughtNSExceptionHandler(NSException *exception) {
    // Handle current exception
    sUncaughtException = exception;
    
    // Handle previous
    if (sPreviousUncaughtExceptionHandler != nullptr) {
        sPreviousUncaughtExceptionHandler(exception);
    }
}
```

在回调函数里只需要保存保存 exception 指针，调用前任回调函数指针即可。NSException 如果没有被 try catch 或 NSSetUncaughtExceptionHandler 捕获处理，则会调用 c 的 abort()，kernal 针对 app 发出 _pthread_kill 的信号，转为 Mach 异常，如果 Mach 异常没有被捕获，则会转换成 Unix 信号。

## 捕获 Unix 信号

```objc
const uint8_t handledBSDSignals[] = {
    SIGSEGV, // signal   11  segmentation violation
    SIGABRT, // signal   6   abort
    SIGFPE,     // signal   8   floating-point exception
    SIGILL,     // signal   4   illegal instruction
    SIGBUS,     // signal   7   BUS
    SIGALRM     // signal   14  alarm
};

void IPhoneCrashHandler::initBSDSignalHandler() {
    struct sigaction act;
    act.sa_flags = SA_SIGINFO;
    act.sa_sigaction = BSDSignalHandler;
    sigemptyset(&act.sa_mask);
    for (int i = 0; i < handledBSDSignalsNum; ++i) {
        sigaction(handledBSDSignals[i], &act, &sPreviousBSDSignalHandler[i]);
        sPreviousBSDSignalHandlerMap.insert( { handledBSDSignals[i], &sPreviousBSDSignalHandler[i] } );
    }
}
```

handledBSDSignals 数组是监听的 signal 列表，调用 sigaction 函数给 signal 设置监听函数 BSDSignalHandler，并将之前设置过的前任监听函数指针保存到 sPreviousBSDSignalHandler，在处理完 Unix 信号后要调用前任函数指针。

```objc
static void BSDSignalHandler(int sig, siginfo_t* siginfo, void* ctx) {
    // Handle current signal
  	// 获取 Unix 信号描述
    NSString *signal = [NSString stringWithFormat:@"%d (%s)", sig, getBSDSignalDescription(sig).data()];
  	// 如果 sUncaughtException 不为 nil，说明是 NSException 抛出的异常
    NSString *exception = sUncaughtException ? [NSString stringWithFormat:@"%@ (%@)", [sUncaughtException name], [sUncaughtException reason]] : nil;
  	// 获取系统时间
    NSString *timestamp = [NSString stringWithCString:GetSystemTimeFormatString().data() encoding:NSUTF8StringEncoding];
  	// 如果是 NSException 异常，则从 sUncaughtException 指针获取堆栈信息，否则从 NSThread 获取，并将堆栈信息格式化处理
    NSArray *stackArray = formatCallbackSymbols(sUncaughtException ? sUncaughtException.callStackSymbols : NSThread.callStackSymbols);
    
    NSMutableString *content = [NSMutableString string];
    [content appendFormat:@"Pid: %d\n", getpid()];
    [content appendFormat:@"Signal: %@\n", signal];
    if (exception) [content appendFormat:@"Exception: %@\n", exception];
    [content appendFormat:@"Timestamp: %@\n", timestamp];
    for (NSString *stack in stackArray) {
        [content appendFormat:@"%@\n", stack];
    }
    
    NSString *saveDir = [NSString stringWithCString:IPhoneCrashHandler::GetInstance()->GetCrashLogFileSaveDir().data() encoding:NSUTF8StringEncoding];
    NSString *fileName = [NSString stringWithFormat:@"%@.crash", timestamp];
    NSString *filePath = [NSString stringWithFormat:@"%@%@", saveDir, fileName];
    [content writeToFile:filePath atomically:YES encoding:NSUTF8StringEncoding error:nil];
    
    // Handle previous
    struct sigaction* previousSigaction = sPreviousBSDSignalHandlerMap[sig];
    if (previousSigaction != nullptr && previousSigaction->sa_sigaction != nullptr) {
        previousSigaction->sa_sigaction(sig, siginfo, ctx);
    }
    
    // Kill with signal SIGKILL
    kill(getpid(), SIGKILL);
}
```

在 Unix 信号的监听函数中，首先可以拿到信号类型，并判断是否是 NSException 抛出的异常，将堆栈信息格式化后写入本地文件，最后调用前任回调函数指针，给程序发送 SIGKILL 信号终止程序。

## C++ 堆栈信息优化

调试过程中发现记录的 c++ 堆栈是经过 [name mangling](https://zhuanlan.zhihu.com/p/359466948) 机制处理过的，写入到日志里可读性比较差，需要做 demangle 处理：

```objc
#include <cxxabi.h>
...
static NSString* getDemangledSymbol(NSString *symbol) {
    size_t maxLength = 1024;
    int demangleStatus;
    char* demangledSymbol = (char*)malloc(maxLength);
    
    if ((demangledSymbol = abi::__cxa_demangle([symbol UTF8String],
                                               demangledSymbol,
                                               &maxLength,
                                             &demangleStatus))
        && demangleStatus == 0) {
        return [NSString stringWithCString:demangledSymbol encoding:NSUTF8StringEncoding];
    } else {
        return nil;
    }
}
```

## 函数堆栈地址优化

通常在 crash 堆栈信息中会有一列是崩溃函数在虚拟内存空间的地址，如果是线上 Release 版本的 crash，日志里一般不会有详细的堆栈函数信息，需要通过程序打包时的符号表 dSYM 文件协助解析崩溃堆栈的地址。dSYM 中记录了程序中函数符号的内存地址，原理上来说 crash 堆栈里的崩溃函数地址应该与 dSYM 里的符号表是一一对应的，但由于苹果的 ASLR 机制的存在，程序在加载时会在前面插入一段随机的 offset，导致 crash 中的堆栈地址和 dSYM 的符号地址会有一个随机的差值。这个 offset 可以在程序运行时获取到，在捕获到 crash 后将堆栈地址减去 offset 保存到文件中，这样就可以直接使用 dSYM 解析出具体的符号。

> ASLR（Address space layout randomization）是一种针对缓冲区溢出的安全保护技术，通过对堆、栈、共享库映射等线性区布局的随机化，通过增加攻击者预测目的地址的难度，防止攻击者直接定位攻击代码位置，达到阻止溢出攻击的目的。据研究表明ASLR可以有效的降低缓冲区溢出攻击的成功率，如今Linux、FreeBSD、Windows等主流操作系统都已采用了该技术。

```
#include <mach-o/dyld.h>
...
static uint64_t getOffsetOfASLR() {
    uint64_t offset = 0;
    for (uint32_t i = 0; i < _dyld_image_count(); i++) {
            if (_dyld_get_image_header(i)->filetype == MH_EXECUTE) {
                offset = _dyld_get_image_vmaddr_slide(i);
                break;
            }
    }
    return offset;
}
```

以这条堆栈信息为例：

`CrashStack[5]:<0x0000000106487418>  xxx (-[IPhoneBridgeObjc showWebView:]+10) `

虽然已经知道它对应的符号，但还只是通过 dSYM 解析看下计算的地址是否正确，需要借助命令行工具 atos：

```shell
atos -o xxx.app.dSYM/Contents/Resources/DWARF/xxx 0x0000000106487418
-[IPhoneBridgeObjc showWebView:] (in xxx) (IPhoneBridge.mm:313)
```



# 参考资料

> iOS Crash/崩溃/异常 捕获 https://www.jianshu.com/p/3f6775c02257
>
> iOS Crash收集,符号化分析看我就够了 https://bucengyongyou.github.io/2016/08/03/iOS-Crash%E6%94%B6%E9%9B%86-%E7%AC%A6%E5%8F%B7%E5%8C%96%E5%88%86%E6%9E%90%E7%9C%8B%E6%88%91%E5%B0%B1%E5%A4%9F%E4%BA%86/
>
> C++函数重载的实现机制之name mangling https://zhuanlan.zhihu.com/p/359466948

# 后记

最近状态有点差，周末在家就只想睡觉了，想学的东西很多，但时间少效率低，要好好调整下了。
