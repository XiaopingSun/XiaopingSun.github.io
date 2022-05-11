---
title: FLV 协议封装
date: 2022-05-10 14:37:48
index_img: https://hexo.qiniu.pursue.show/flv.png
banner_img:
categories: 音视频开发
tags: [Flash Video]
sticky:
---

# 前言

这篇简单记录一下 FLV 的封装过程。

# FLV 封装格式简介

FLV（Flash Video）是 Adobe 公司设计开发的一种流行的流媒体格式，由于其视频文件体积轻巧、封装简单等特点，使其很适合在互联网上进行应用。此外，FLV 可以使用 Flash Player 进行播放，而 Flash Player 插件已经安装在全世界绝大部分浏览器上，这使得通过网页播放FLV视频十分容易，FLV封装格式的文件后缀通常为“.flv”。

FLV 数据流由一个个的 Tag 组成，一个 FLV 中最多只能包含一路视频流和一路音频流，同一个类型的 Tag 也不能定义多条独立的流。另外 FLV 在存储时使用大端，所以在写入数据时需要注意字节序的转换。

FLV 的基本结构：

![flv结构](https://hexo.qiniu.pursue.show/flv%E7%BB%93%E6%9E%84.png)

可以看到 FLV 的结构相对比较简单，由一个固定长度的 FLV Header 和包含若干 Tag 的 FLV Body 构成，Tag 的类型可以是 Audio（音频数据）、Video（视频数据） 或 Script（元数据），每个 Tag 前面有一个 PreviousTagSize 字段用来标识前一个 Tag 的长度。

## FLV Header

FLV Header 是整个 FLV 文件的开始，固定长度为 9 个字节，它包含以下字段：

| 字段              | 字段长度/类型 | 字段内容                                                     |
| ----------------- | ------------- | ------------------------------------------------------------ |
| Signature         | UI8           | 签名字段，总是 0x46，'F'                                     |
| Signature         | UI8           | 签名字段，总是 0x4C，'L'                                     |
| Signature         | UI8           | 签名字段，总是 0x56，'V'                                     |
| Version           | UI8           | 版本号，0x01 代表 FLV version 1                              |
| TypeFlagsReserved | UB[5]         | 保留字段，必须是 0                                           |
| TypeFlagsAudio    | UB[1]         | 如果是 1 说明 FLV 中包含音频 Tag                             |
| TypeFlagsReserved | UB[1]         | 保留字段，必须是 0                                           |
| TypeFlagsVideo    | UB[1]         | 如果是 1 说明 FLV 中包含视频 Tag                             |
| DataOffset        | UI32          | FLV Body 距离文件起始位置的偏移量，即 FLV Header 的长度。在 FLV version 1 中固定是 9。 |

## FLV Body

从第 10 个字节开始是 FLV Body，包含多个 PreviousTagSize 和 Tag 的组合对：

| 字段             | 字段长度/类型 | 字段内容                                        |
| ---------------- | ------------- | ----------------------------------------------- |
| PreviousTagSize0 | UI32          | 由于 PreviousTagSize0 前面没有 Tag 所以一定是 0 |
| Tag1             | FLVTAG        | 第一个 Tag                                      |
| PreviousTagSize1 | UI32          | Tag1 的长度（Tag Header + Tag Body）            |
| Tag2             | FLVTAG        | 第二个 Tag                                      |
| ...              | ...           | ...                                             |

### PreviousTagSize

表示前一个 Tag 的长度，固定为 4 字节的无符号整型。

### Tag

Tag 用来负载实际的数据，为了标识 Tag 的类型和其他信息，又将 Tag 拆分成 Tag Header 和 Tag Body：

#### Tag Header

固定长度为 11 个字节，包含以下字段：

| 字段              | 字段长度/类型 | 字段内容                                                     |
| ----------------- | ------------- | ------------------------------------------------------------ |
| TagType           | UI8           | 标识 Tag 类型<br />8：audio<br />9：video<br />18：script    |
| DataSize          | UI24          | Tag Body 的长度                                              |
| Timestamp         | UI24          | 相对于第一个 Tag 的时间戳，单位为 ms<br />第一个 Tag 时间戳是 0 |
| TimestampExtended | UI8           | 时间戳的扩展，如果 Timestamp 的 3 字节不够用，会增加 TimestampExtended 表示最高的 8 位 |
| StreamID          | UI24          | 固定是 0                                                     |

在播放回放的场景时，FLV 会始终依赖 Tag Header 里的时间戳，而忽略使用 Tag Data 负载中的时间信息。

#### Tag Body

从 Tag Header 中可以知道这个 Tag 的类型是音频、视频还是元信息，负载的大小和时间信息，下面将这三种类型分开讨论：

##### AudioData

解析音频编码数据前，需要让播放端知晓一些信息，比如编码格式、采样率、位深、声道数，播放端需要这些信息去初始化解码器，所以 AudioData 中除了音频编码数据外还有一些信息字段：

| 字段        | 字段长度/类型           | 字段内容                                                     |
| ----------- | ----------------------- | ------------------------------------------------------------ |
| SoundFormat | UB[4]                   | 音频编码格式：<br />0 = Linear PCM, platform endian<br/>1 = ADPCM<br/>2 = MP3<br/>3 = Linear PCM, little endian<br/>4 = Nellymoser 16-kHz mono<br/>5 = Nellymoser 8-kHz mono<br/>6 = Nellymoser<br/>7 = G.711 A-law logarithmic PCM 8 = G.711 mu-law logarithmic PCM 9 = reserved<br/>10 = AAC<br/>11 = Speex<br/>14 = MP3 8-Khz<br/>15 = Device-specific sound |
| SoundRate   | UB[2]                   | 音频采样率，对于 AAC 总是 3：<br />0 = 5.5-kHz<br/>1 = 11-kHz<br/>2 = 22-kHz<br/>3 = 44-kHz |
| SoundSize   | UB[1]                   | 音频采样位深：<br />0 = snd8Bit<br/>1 = snd16Bit             |
| SoundType   | UB[1]                   | 声道数，对于 Nellymoser 总是 0，对于 AAC 总是 1：<br />0 = sndMono<br/>1 = sndStereo |
| SoundData   | UI8[size of sound data] | 包含负载数据的最后一层，根据不同的编码格式，还会区分不同的结构，如果编码是 AAC，则是 AACAUDIODATA 结构 |

######  AACAUDIODATA

先看看它长什么样子：

| 字段          | 字段长度/类型 | 字段内容                                                     |
| ------------- | ------------- | ------------------------------------------------------------ |
| AACPacketType | UI8           | 用来标识 AAC Packet 的类型<br />0: AAC sequence header<br/>1: AAC raw |
| Data          | UI8[n]        | 如果 AACPacketType 为 0，是两字节的 AudioSpecificConfig；<br />如果 AACPacketType 为 1，是 AAC 帧数据。 |

如[维基百科](https://wiki.multimedia.cx/index.php/MPEG-4_Audio#Audio_Specific_Config)上关于 AudioSpecificConfig（后面简称 ASC） 的描述：

> The Audio Specific Config is the global header for MPEG-4 Audio:
>
> ```objc
> 5 bits: object type
> if (object type == 31)
>     6 bits + 32: object type
> 4 bits: frequency index
> if (frequency index == 15)
>     24 bits: frequency
> 4 bits: channel configuration
> var bits: AOT Specific Config
> ```

ASC 是 MPEG-4 定义的 AAC 的一个全局头部，它包含编码类型（object type），采样率（frequency index）、通道数（channel configuration）和 AOT Specific Config（未知，我们暂时没有用到）。可以看到有些字段在 AudioData 中是有定义过的，这里为什么会要求重新传呢？可以看下 adobe 官方文档上的解释：

>If the SoundFormat indicates AAC, the SoundType should be set to 1 (stereo) and the SoundRate should be set to 3 (44 kHz). However, this does not mean that AAC audio in FLV is always stereo, 44 kHz data. Instead, the Flash Player ignores these values and extracts the channel and sample rate data is encoded in the AAC bitstream.

可以看到对于 AAC 格式， Adobe 的 Flash Player 并没有使用 AudioData 中的编码类型、采样率、通道数信息，而是读取的 ASC 中的信息，猜测一部分原因是 AudioData 中定义的信息类型有些局限，而 ASC 中相当于扩展了可选编码类型、采样率和通道数，使 FLV 能更好地兼容负载编码数据的特性。

由于 ASC 是一个全局的头部信息，所以在打包 Audio Tag 时，第一个 Audio Tag 需要携带 ASC（AACPacketType = 0），后续的 Audio Tag 才是 AAC 帧数据（AACPacketType = 1），后面的例子里可以看到。

##### VideoData

解码视频帧之前需要让播放器知晓编码类型等其他参数用于解码，所以除了视频帧数据还有一些参数信息在 VideoData 里：

| 字段      | 字段长度/类型           | 字段内容                                                     |
| --------- | ----------------------- | ------------------------------------------------------------ |
| FrameType | UB[4]                   | 帧类型，对于 AVC 关键帧 是 1，非关键帧是 2<br />1: keyframe (for AVC, a seekable frame) <br/>2: inter frame (for AVC, a non- seekable frame)；<br/>3: disposable inter frame (H.263 only)<br/>4: generated keyframe (reserved for server use only)<br/>5: video info/command frame |
| CodecID   | UB[4]                   | 编码类型，AVC 是 7<br />1: JPEG (currently unused)<br/>2: Sorenson H.263<br/>3: Screen video<br/>4: On2 VP6<br/>5: On2 VP6 with alpha channel 6: Screen video version 2<br/>7: AVC |
| VideoData | UI8[size of video data] | 根据编码类型的不同，VideoData 又分为不同的负载格式，对于 AVC 是  AVCVIDEOPACKET:<br />If CodecID == 2:  H263VIDEOPACKET<br/>If CodecID == 3 SCREENVIDEOPACKET<br/>If CodecID == 4: VP6FLVVIDEOPACKET<br/>If CodecID == 5: VP6FLVALPHAVIDEOPACKET<br/>If CodecID == 6: SCREENV2VIDEOPACKET<br/>If CodecID == 7: AVCVIDEOPACKET |

###### AVCVIDEOPACKET

| 字段            | 字段长度/类型 | 字段内容                                                     |
| --------------- | ------------- | ------------------------------------------------------------ |
| AVCPacketType   | UI8           | 标识 AVC Packet 的负载类型：<br />0: AVC sequence header<br/>1: AVC NALU<br/>2: AVC end of sequence |
| CompositionTime | SI24          | 当 AVCPacketType 为 1 时，CompositionTime 表示该 AVC 视频帧 pts 和 dts 的偏移，单位毫秒，AVCPacketType 不为 1 时为 0 |
| Data            | UI8[n]        | Tag 实际负载的视频编码数据<br />AVCPacketType 为 0 时负载为 AVCDecoderConfigurationRecord 即 sps、pps；<br />AVCPacketType 为 1 时负载为一个或多个 NALU 单元；<br />AVCPacketType 为 1 时为空。 |

FLV 封装 H264 时使用的是 AVCC 标准而非 AnnexB，所以 sps 和 pps 需要单独打包成 ExtraData，而不是作为一个 NALU 来发送。FLV 使用 AVCPacketType 字段标识负载是 ExtraData 还是视频帧数据 NALU，ExtraData 的字段参考：[码流格式: Annex-B, AVCC(H.264)与HVCC(H.265), extradata详解](https://blog.csdn.net/yue_huang/article/details/75126155)

##### ScriptData

ScriptData 中一般包含音视频的 meta data 信息，使用 AMF 编码，由于要支持多种数据类型和可变长度，所以相对会复杂一点，首先看下 ScriptData 的整体结构：

| 字段    | 字段长度/类型      | 字段内容                                    |
| ------- | ------------------ | ------------------------------------------- |
| Objects | SCRIPTDATAOBJECT[] | 任意数量的 SCRIPTDATAOBJECT 结构            |
| End     | UI24               | 标识 ScriptData 的结束，总是 9，即 0x000009 |

###### SCRIPTDATAOBJECT 结构

| 字段       | 字段长度/类型    | 字段内容      |
| ---------- | ---------------- | ------------- |
| ObjectName | SCRIPTDATASTRING | Object 的名称 |
| ObjectData | SCRIPTDATAVALUE  | Object 的内容 |

###### SCRIPTDATASTRING 结构

| 字段         | 字段长度/类型 | 字段内容   |
| ------------ | ------------- | ---------- |
| StringLength | UI16          | 字符串长度 |
| StringData   | STRING        | 字符串内容 |

###### 还有一个长字符的 SCRIPTDATALONGSTRING 结构

| 字段         | 字段长度/类型 | 字段内容   |
| ------------ | ------------- | ---------- |
| StringLength | UI32          | 字符串长度 |
| StringData   | STRING        | 字符串内容 |

AMF 编码的 key 一般会是一个字符串，在编码字符串前需要先编码字符串的长度，如果长度大于 UI16 Max，可以使用 SCRIPTDATALONGSTRING 拓展成 32 位表示长度，这里有个问题，拿什么来标识是 SCRIPTDATASTRING 还是 SCRIPTDATALONGSTRING？先看下 SCRIPTDATAVALUE 的结构：

###### SCRIPTDATAVALUE 结构

| 字段                      | 字段长度/类型                                                | 字段内容                                                     |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Type                      | UI8                                                          | 变量的类型：<br />0 = Number type<br/>1 = Boolean type<br/>2 = String type<br/>3 = Object type<br/>4 = MovieClip type<br/>5 = Null type<br/>6 = Undefined type<br/>7 = Reference type 8 = ECMA array type 10 = Strict array type 11 = Date type<br/>12 = Long string type |
| ECMAArrayLength           | 仅 Type = 8 时，UI32                                         | ECMA 数组长度                                                |
| ScriptDataValue           | If Type == 0 DOUBLE<br />If Type == 1 UI8<br />If Type == 2 SCRIPTDATASTRING<br />If Type == 3 SCRIPTDATAOBJECT<br />If Type == 4 SCRIPTDATASTRING<br />defining the MovieClip path<br />If Type == 7 UI16<br />If Type == 8 SCRIPTDATAVARIABLE[ECMAArrayLength]<br />If Type == 10 SCRIPTDATAVARIABLE[n]<br />If Type == 11 SCRIPTDATADATE<br />If Type == 12 SCRIPTDATALONGSTRING | Value 数据，定义了具体类型                                   |
| ScriptDataValueTerminator | if Type == 3 SCRIPTDATAOBJECTEND<br />if Type == 8 SCRIPTDATAVARIABLEEND | Object 和 Array 的结束标识，对于ECMA array 结束标识为 0x000009 |

如果 Type == 8，即 ECMA Array，在一字节的 Type 字段后会有 4 个字节的 ECMAArrayLength 标识数组长度，ScriptDataValue 内容类型为 SCRIPTDATAVARIABLE，数组的结束标识为 ScriptDataValueTerminator 即 0x000009。

###### SCRIPTDATAVARIABLE 结构

| 字段         | 字段长度/类型    | 字段内容 |
| ------------ | ---------------- | -------- |
| VariableName | SCRIPTDATASTRING | 变量名称 |
| VariableData | SCRIPTDATAVALUE  | 变量内容 |

# 实现思路

项目依赖的 RTMP 框架是 librtmp，这个框架在发送 FLV Tag 时，只需要外层传入 Tag Body 和 Tag Header 的一些参数描述，librtmp 内部会自己打包成 FLV Tag。所以先自定义一个 flv_tag 的结构体用于描述 Tag Header 并携带 Tag Body 数据：

```objc

/**
 * FLV Tag 类型定义
 */
struct flv_tag {
    uint8_t     tag_type;
    uint32_t    data_size;
    uint32_t    timestamp;
    uint32_t    stream_id;
    void        *data;  
};

typedef struct flv_tag, flv_tag_t
typedef struct flv_tag, *flv_tag_p
```

所以要做的就是用 metaData、video、audio 数据构建这个结构体，创建一个本地写入的类，先后写入 FLV Header、Script Tag、Audio & Video Tag，写入完成后我们使用 ffplay 播放 FLV 文件，并使用 UltraEdit 来查看二进制流来分析。

# 部分代码实现

## Script Tag 的生成

首先需要根据官方文档的 AMF 编码方式生成 metaData，再封装成 flv_tag 结构体：

```objc
#define kFlvScriptTagBodyLength 222
#define FLV_TAG_TYPE_SCRIPT ((uint8_t)0x12)

...
  	// 创建 script tag body 指针，kFlvScriptTagBodyLength 需要根据下边的 metadata 字段提前计算好
    uint8_t *data = malloc(kFlvScriptTagBodyLength);
    uint8_t *p = data;
  
    // 写入1字节字符串类型 + 2字节字符串长度 + 10字节字符串 
    p = put_string(p, "onMetaData", 10);  // 13
  
  	// 写入1字节 EMCA 数组类型
    p = put_byte(p, kAMFEMCAArray); // 1
  
  	// 写入4字节数组长度
    p = put_be32(p, 8); // 4
    
  	// 写入2字节字符串长度 + 8字节字符串 + 1字节double类型 + 8字节double值
    p = put_named_double(p, "duration", 8, 0.0);    // 8 + 11
    p = put_named_double(p, "width", 5, 720);  // 5 + 11
    p = put_named_double(p, "height", 6, 1280);    // 6 + 11
    p = put_named_double(p, "videocodecid", 12, 7);    // 12 + 11
    p = put_named_double(p, "audiodatarate", 13, 128);  // 13 + 11
    p = put_named_double(p, "audiosamplerate", 15, 48000); // 15 + 11
    p = put_named_double(p, "audiocodecid", 12, 10);   // 12 + 11
    
  	// 写入2字节字符串长度 + 8字节字符串 + 1字节字符串类型 + 2字节字符串长度 + 19字节字符串
    p = put_named_string(p, "app_name", 8, "XPLivePusherKitDemo", 19);  // 8 + 19 + 5
    p = put_named_string(p, "app_version", 11, "1.0.0", 5);  // 11 + 5 + 5
    
  	// 写入结束标识 0x000009
    p = put_be16(p, 0); // 2
    p = put_byte(p, kAMFObjectEnd); // 1
    
  	// 封装成 flv_tag
    flv_init_tag(_script_tag,
                 FLV_TAG_TYPE_SCRIPT,
                 kFlvScriptTagBodyLength,
                 XPGetTimeStampOffset(_timeBase),
                 0,
                 data);
...
```

## Audio Tag 的生成

AAC 编码格式的 Audio Tag Body 包含三块内容：1 字节的 Flags、1 字节的 AACPacketType 以及负载数据，Flags 包括 4 bit 的编码格式、2 bit 的采样率、1 bit 的位深、1 bit 的通道数，所以在封装 flv_tag 之前这些参数是需要准备的：

```objc
#define FLV_AUDIO_TAG_SOUND_FORMAT_AAC   10 << 4
#define FLV_AUDIO_TAG_SOUND_SIZE_16      1 << 1
#define FLV_AUDIO_TAG_SOUND_TYPE_MONO    0x00
#define FLV_AUDIO_TAG_SOUND_TYPE_STEREO  0x01

#define FLV_AUDIO_TAG_SOUND_RATE_11      1 << 2
#define FLV_AUDIO_TAG_SOUND_RATE_22      2 << 2
#define FLV_AUDIO_TAG_SOUND_RATE_44      3 << 2

...
    // 判断单双声道
    int flvStereoOrMono = (2 == channelCount) ? FLV_AUDIO_TAG_SOUND_TYPE_STEREO : FLV_AUDIO_TAG_SOUND_TYPE_MONO;

    // 创建 Flags，根据参数给对应的 bit 位写值
    int flags = 0;
    flags = FLV_AUDIO_TAG_SOUND_FORMAT_AAC | FLV_AUDIO_TAG_SOUND_SIZE_16 | flvStereoOrMono;

    switch (sampleRate) {
      case 11025:
        flags |= FLV_AUDIO_TAG_SOUND_RATE_11;
        break;
      case 22050:
        flags |= FLV_AUDIO_TAG_SOUND_RATE_22;
        break;
      case 44100:
        flags |= FLV_AUDIO_TAG_SOUND_RATE_44;
        break;
      default:
        break;
    }
    int32_t size = (int32_t)(AACFrame.dataSize + 2);
    flv_tag_p flv_tag = flv_create_tag();
    uint8_t *data = malloc(size);

    // 判断负载是 ASC 还是 AAC Packet
    BOOL isAudioSpecificConfig = (AACFrame.dataSize == 2);

    // 写入
    uint8_t *p = data;
    p = put_byte(p, flags);
    p = put_byte(p, isAudioSpecificConfig ? NO : YES);
    p = put_buff(p, AACFrame.data, AACFrame.dataSize);

    // 封装 flv_tag
    flv_init_tag(flv_tag,
                 FLV_TAG_TYPE_AUDIO,
                 size,
                 (uint32_t)metaData.pts,
                 0,
                 data);
...
```

## Video Tag 的生成

AVC 编码的 Video Tag 负载类型一般有两种，AVC sequence header 即 AVCDecoderConfigurationRecord，以及 NALU，在负载内容前需要标识 1 字节的 Flags（包含 4 bit 帧类型 FrameType 和 4 bit 编码类型CodecID），接着是 1 字节的 AVCPacketType 和 3 字节的 CompositionTime：

### AVCDecoderConfigurationRecord

iOS 的 VideoToolBox 回调方法中拿到的 sps 和 pps 是独立的，需要将他们打包成 extradata 放到 Tag Body 里作为负载数据：

```objc
#define FLV_VIDEO_TAG_CODEC_AVC               7
#define FLV_VIDEO_TAG_FRAME_TYPE_KEYFRAME     1 << 4

...
    // 创建 Flags，写入编码类型
    int flags = 0;
    flags = FLV_VIDEO_TAG_CODEC_AVC | FLV_VIDEO_TAG_FRAME_TYPE_KEYFRAME;

    uint8_t *conf = NULL;
    int32_t outputDataSize = 0;

    // 计算拼接好的 extradata长度
    size_t confSize = 11 + __spsSize + __ppsSize;
    conf = (uint8_t *)malloc(confSize);
    uint8_t *p2 = conf;

    // version
    p2 = put_byte(p2, 1); 
    // avc profile
    p2 = put_byte(p2, __sps[1]); 
    // avc compatibility
    p2 = put_byte(p2, __sps[2]); // compat
    // avc level
    p2 = put_byte(p2, __sps[3]); 
    // 0xFC | (2bit 的 NALU 长度占用字节 - 1) ff：4  11111111
    p2 = put_byte(p2, 0xff);   
    // 0xE0 | (5bit 的 sps 个数) e1：1  11111101
    p2 = put_byte(p2, 0xe1);   
    // sps size
    p2 = put_be16(p2, __spsSize);
    // sps data
    p2 = put_buff(p2, (const uint8_t *)__sps, __spsSize);
    // pps 个数
    p2 = put_byte(p2, 1);
    // pps size
    p2 = put_be16(p2, __ppsSize);
    // pps data
    p2 = put_buff(p2, (const uint8_t *)__pps, __ppsSize);

    // Tag Body 整体大小
    outputDataSize = (int32_t)(confSize + 5);				
    uint8_t *outputData = (uint8_t *)malloc(outputDataSize);

    uint8_t *p = outputData;
    // 写入 Flags
    p = put_byte(p, flags);
    // 写入 AVCPacketType，0 为 extradata
    p = put_byte(p, 0);
    // 写入 CompositionTime
    p = put_be24(p, (int)(metaData.pts - metaData.dts));
    // 写入 extradata
    p = put_buff(p, conf, confSize);

    // 封装 flv_tag
    flv_tag_p tag = flv_create_tag();
    flv_init_tag(tag,
                 FLV_TAG_TYPE_VIDEO,
                 outputDataSize,
                 (uint32_t)metaData.pts,
                 0,
                 outputData);
...
```

### NALU

NALU 的封装相对简单一点：

```objc
#define FLV_VIDEO_TAG_FRAME_TYPE_KEYFRAME     1 << 4
#define FLV_VIDEO_TAG_FRAME_TYPE_INTERFRAME   2 << 4

...
    // 创建 Flags 写入编码类型和帧类型
    int flags = 0;
    flags = FLV_VIDEO_TAG_CODEC_AVC;

    if (XPNALUTypeIDR ==  naluFrame.type || XPNALUTypeSEI == naluFrame.type) {
      flags |= FLV_VIDEO_TAG_FRAME_TYPE_KEYFRAME;
    } else {
      flags |= FLV_VIDEO_TAG_FRAME_TYPE_INTERFRAME;
    }

    // 计算 Tag Body 总长度
    int32_t outputDataSize = 5 + (int32_t)naluFrame.dataSize;
    uint8_t *outputData = (uint8_t *)malloc(outputDataSize);

    uint8_t *p = outputData;
    // 写入 Flags
    p = put_byte(p, flags);
    // 写入 AVCPacketType，1 为 NALU
    p = put_byte(p, 1);
    // 写入 CompositionTime
    p = put_be24(p, (int)(metaData.pts - metaData.dts));
    // 写入 NALU
    p = put_buff(p, (const uint8_t *)naluFrame.data, naluFrame.dataSize);

    // 封装 flv_tag
    flv_tag_p tag = flv_create_tag();
    flv_init_tag(tag,
                 FLV_TAG_TYPE_VIDEO,
                 outputDataSize,
                 (uint32_t)metaData.pts,
                 0,
                 outputData);
...
```

## FLV Header 的写入

FLV Header 一共是 9 个字节，包含 Signature、Version、Flags 和 Headersize，写入时需要注意 FLV 采用大端的字节序，而 iOS 平台是小端，写入大于一个字节数字类型时需要调整字节序，SetValue 函数提供了这样的功能：

```objc
//    - FLV Header（9字节）：
//        1.Signature（3字节） 文件表示  总为"FLV"（0x46, 0x4c, 0x56）
//        2.Version（1字节） 版本号   目前为0x01
//        3.Flags（1字节） 前5位保留  必须为0   第6位标识是否存在音频Tag   第7位保留  必须为0  第8位标识是否存在视频Tag
//        4.Headersize（4字节） 从FLV Header开始到FLV Body开始的字节数  版本1中总是9

#define kFlvHeaderLength 9
#define kFlvTagHeaderFlags_Audio 0x04
#define kFlvTagHeaderFlags_Video 0x01

...
    int index = 0;
    char* signature = "FLV";
    uint8_t version = 1;
    uint8_t flags = kFlvTagHeaderFlags_Audio | kFlvTagHeaderFlags_Video;
    uint32_t headerSize = kFlvHeaderLength;
    
    SetValue(header, &index, (uint8_t *)signature, 3, NO);
    SetValue(header, &index, (uint8_t *)&version, 1, YES);
    SetValue(header, &index, (uint8_t *)&flags, 1, YES);
    SetValue(header, &index, (uint8_t *)&headerSize, 4, YES);
...
```

FLV Header 获取到后，使用 NSFileManager 在本地创建文件，使用 NSFileHandler 负责后续 Tag 的写入：

```objc
#define kFlvHeaderLength 9
...
    NSData *flvFileHeaderData = [NSData dataWithBytes:flvHeader length:kFlvHeaderLength];
    [[NSFileManager defaultManager] createFileAtPath:filePath contents:flvFileHeaderData attributes:nil];
    _filledLength += kFlvHeaderLength;
    
    _handle = [NSFileHandle fileHandleForWritingAtPath:filePath];
    [_handle seekToEndOfFile];
...
```

## FLV Tag 的写入

将 previousTagSize 和 Tag Header 放在一起写入：

```objc
//    - Tag Header（11字节）：
//        1.Type（1字节） 表示Tag类型  包括音频(0x08)  视频(0x09)和script data(0x12)
//        2.Datasize（3字节） 表示该Tag Data部分的大小
//        3.Timestamp（3字节） 表示该Tag的时间戳
//        4.Timestamp_ex（1字节） 表示时间戳的扩展字节  当24位数值不够时  该字节作为最高位将时间戳扩展为32位数值
//        5.StreamID（3字节） 表示stream id  总是0
    
//    每个Tag前面是一个Previous Tag Size字段（4字节）  表示前面一个Tag的大小

#define kFlvPreviousTagSizeLength 4
#define kFlvTagHeaderLength 11

...    
    uint8_t header[kFlvPreviousTagSizeLength + kFlvTagHeaderLength];
    int index = 0;
    
		// timestamp 中高位 1 字节
    uint8_t timestampUpper1Byte = flvTag->timestamp >> 24;
		// timestamp 中低位 3 字节
    uint32_t timestampLower3Bytes = flvTag->timestamp & 0x00FFFFFF;
    
		// 写入 4 字节 previousTagSize
    SetValue(header, &index, (uint8_t *)&_previousTagSize, kFlvPreviousTagSizeLength, YES);
		// 写入 1 字节 Tag 类型，0x08 音频，0x09 视频，0x12 Script
    SetValue(header, &index, (uint8_t *)&(flvTag->tag_type), 1, YES);
		// 写入 Tag Body 长度
    SetValue(header, &index, (uint8_t *)&(flvTag->data_size), 3, YES);
		// 写入低位 3 字节时间戳
    SetValue(header, &index, (uint8_t *)&timestampLower3Bytes, 3, YES);
		// 写入高位 1 字节时间戳
    SetValue(header, &index, (uint8_t *)&timestampUpper1Byte, 1, YES);
		// 写入 stream Id 固定是 0
    SetValue(header, &index, (uint8_t *)&(flvTag->stream_id), 3, YES);
    
    NSData *data = [NSData dataWithBytes:header length:sizeof(header)];
    [_handle writeData:data];
...
```

Tag Header 写好后，把上面生成好的 Tag Body 直接写入即可：

```objc
...
		NSData *data = [NSData dataWithBytes:flvTag->data length:flvTag->data_size];
    [_handle writeData:data];
...
```

写入时一般第一个 Tag 会是 Script Tag，之后是音视频 Tag。文件写好后，下载好沙盒文件，用 ffplay 播放查看效果：

![metadata](https://hexo.qiniu.pursue.show/meta.png)

黄框部分是 Script Tag 中携带的 metadata 的一部分，ffmpeg 貌似只打印值是字符串的字段，红色部分则是从 ASC 和 sps/pps 中解析出的音视频编码参数，有两个 Stream 说明播放器已经解析出 FLV 包含音频和视频，剩下的就是观察画面和声音是否正常，音画是否同步。

# 二进制文件分析

写好后的 FLV 文件可以用 UltraEdit 打开查看二进制信息：

![flv_byte_audio](https://hexo.qiniu.pursue.show/byte-audio.png)

红框部分是 FLV Header，可以看到前三个字节 0x46、0x4C、0x56 是协议名 FLV，第四个字节 0x01 是 FLV 版本，第五个字节 0x05 即 00000101，表示 FLV 流中包含音频和视频的 Tag。

第一个篮框部分是 previousTagSize0，由于前面没有 Tag，所以这 4 字节固定为 0。

接着黄框部分是第一个 Tag 的 Header，首字节是 0x12，说明第一个 Tag 是 Script Tag，之后的 3 字节 0x00000DE 表示 Tag Body 的长度为 222，再往后的 4 个字节 0x00000000 表示 Tag 的时间戳，最后 3 字节表示 stream id 为 0。

黄框后的部分是 Tag Body，也就是 metaData 数据了，可以看到右侧已经解析出了部分 metadata。Tag Body 的起始位置是 0x00000018 加上 0x00000DE 的长度，Tag Body 的结束位置应该在 0x000000F5，可以看到 0x000000F3、0x000000F4、0x000000F5 这三个字节刚好是 AMF 定义的结束标识 0x000009 ，说明 metadata 写入是 OK 的。

接下来第二个蓝框表示第一个 Script Tag 的长度，11 字节的 Tag Header，222 字节的 Tag Body 加一起刚好是 0x000000E9。

第二个黄框是第二个 Tag 的 Header，0x08 说明是一个音频 Tag，然后跨过 Header 其他字段直接看 Tag Body，第一个字节 A2 即10100010，前 4 位表示编码类型是 AAC，第 5、6 位表示采样率 5.5-kHz（其实这里应该固定是 3，即 44.1-kHz，但因为解码并没有依赖这个字段，而是依赖 ASC，所以这里没有影响），第 7 位表示 16 位深，第 8 位表示单声道。再往后第二个字节是 AACPacketType，0x00 表示这个 Audio Tag 的负载是 ASC，所以之后的两个字节 0x1188 是 ASC。

接着第三个蓝框表示第二个 Audio Tag 的长度，11 字节的 Tag Header 加上 4 字节的 Tag Body 刚好是 0x0000000F。

第三个黄框首字节依然是 0x08，音频 Tag，可以看到 Tag Body 第二个字节的 AACPacketType 是 0x01，说明 Audio Tag 携带的是 AAC Packet。

再来看下视频的 Tag：

![flv_byte_video](https://hexo.qiniu.pursue.show/byte-video.png)

这个 FLV 文件的第一个 Tag 依然是 Script Tag，接着是视频 Tag。

第二个黄框的首字节 0x09 标识是一个视频 Tag，Tag Body 的首字节 0x17 即 00010111，前 4 位标识是一个关键帧（虽然这是个 extradata 的 Tag，但还是标记成关键帧），后 4 位标识编码类型 AVC，之后第二个字节 AVCPacketType 是 0x00 说明这个视频 Tag 负载的是 extradata，服务端获取后可以解析出 sps/pps。

第三个黄框的首字节 0x09 说明还是一个视频 Tag，不同的是这个 Tag 的 Body 第二字节 AVCPacketType 是 0x01，说明 Tag 负载的是 NALU，并且第一个字节 0x17 还说明负载中的 NALU 中包含关键帧。

# 后记

至此 FLV 封装就完成了，如果本地播放没有问题，就可以用 Tag Body 和 Tag Header 信息构造 librtmp 的 RTMPPacket 结构体，通过 RTMP 协议推送给服务端了。

# 参考文档

> Adobe 官方文档 https://rtmp.veriskope.com/pdf/video_file_format_spec_v10.pdf
>
> 之前按雷神文档写过的一个 FLV 解析工具 https://github.com/XiaopingSun/AVTools/blob/main/AVTools/Module/FLVMediainfo/FLVMediainfo.cpp
>
> FLV 协议5分钟入门浅析 https://www.cnblogs.com/chyingp/p/flv-getting-started.html
>
> MPEG-4 Audio 维基百科 https://wiki.multimedia.cx/index.php/MPEG-4_Audio#Sampling_Frequencies
>
> 码流格式: Annex-B, AVCC(H.264)与HVCC(H.265), extradata详解 https://blog.csdn.net/yue_huang/article/details/75126155
