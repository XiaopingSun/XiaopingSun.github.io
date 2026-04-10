---
title: Unreal Engine 音频初体验
date: 2026-04-08 14:29:26
categories:
  - [互联网技术笔记, Unreal Engine 音频]
sticky:
---

# 前言

先从搭建一个简单的音频场景开始，根据 Unreal Engine 音频引擎概览里的顺序创建使用音频基础组件。最近刚好要调研空间音频，就先使用 Unreal 提供的第一人称模板，依次创建音源、效果链、空间化、子混音等组件，让场景中的第一人称视角角色可以感受到各音频组件的作用效果，先学会使用它，再去研究技术实现。使用的 Unreal Engine 版本是 5.7.3。

# 场景搭建

## Sound Source

Unreal Engine 中使用的音源包括 Sound Wave，Sound Cue 以及 UE5 新推出的 Meta Sound，Sound Wave 相对基础一些，创建 Sound Wave 只需将准备好的音频资源（mp3 格式）拖入到资产面板中。根据 [导入音频文件](https://dev.epicgames.com/documentation/unreal-engine/importing-audio-files) 文档描述，Unreal Engine 支持的音频格式有 .wav 、 .ogg 、 .flac 、 .aif，使用 5.7.3 版本编辑器测试发现 .mp3 格式也是支持的，导入资产后 Unreal Engine 将使用 libsndfile 对音频做解码。支持 16、24 的位深，任意采样率以及 Mono、Stereo、4.0、5.1、7.1 的通道数。所有导入的音频文件会被转换成 16 位 .wav 文件，并生成 USoundWave 资产。编辑器在保存时使用 Oodle 压缩打包成 .uasset，这也是为什么转换后的音频资产包大小要比按位深等参数计算的 .pcm 裸数据的大小要小的原因。在音频资产烘焙阶段，编辑器会根据 Project Settings 中指定的默认压缩类型来压缩 Runtime 的资产，默认是 Bink Audio。导入后的资产详情：

![Soundwave](https://hexo.qiniu.pursue.top/unreal_audio_soundwave.png)

双击 Sound Wave 可打开资产详情页，如果安装了 Waveform Editor 插件，可在右侧显示音频的波形图。详情页中大致包含以下四方面的信息：
* 音源的基础信息描述。
* 基础整形工具，比如波形标准化、淡入淡出等。
* 音源串联的效果链及空间化配置
* 音频基础分析

![Soundwave Detail](https://hexo.qiniu.pursue.top/unreal_audio_soundwave_detail.png)

## Audio Component

为了测试音频空间化的效果，需要在编辑器构造的场景中放置一个音源的载体，类比于现实环境中的音响、收音机一类的可发声装置。将之前创建的 SoundWave 资产拖入到场景中即可自动创建一个 Ambient Sound Actor 并挂载一个 Audio Component。Unreal Engine 采用 Actor-Component 架构，Ambient Sound Actor 是这个发声装置的物理载体，Audio Component 则负责音频相关的计算。

![AudioComponent](https://hexo.qiniu.pursue.top/unreal_audio_audiocomponent.png)

可以看到 Audio Component 一样具有 Sound Effect Chain 和 Attenuation 的设置，区别是 Audio Component 的效果链与音源的效果链是叠加计算的，而空间化配置则是覆盖。除此之外 Audio Component 还可以调节音量、音调等基本参数，可以把它想象成一个电吉他音箱，除了还原音源（吉他+效果器）本身生成的声音外，还可以有一些个性化的调节，让同一音源的表现可以差异化。

将 Audio Component 的 Auto Activate 选项勾选，运行游戏即可启动音源的播放。

## Sound Effect

接下来给音源添加效果链，需要明确的是效果链作用于 Sound Wave 还是 Audio Component，这里我们将效果链作用于 Sound Wave，类比于给电吉他接上效果器。首先在资产面板创建 Source Effect Preset，弹出面板中列出了 16 个内置的效果器预设，选择 SourceEffectEQPreset，我们希望给音源加一个均衡效果器。在均衡效果器中可以调节频段、带宽和增益等参数，我们希望给低频 500hz 左右的频段添加 3db 的增益：

![SourceEffect EQ](https://hexo.qiniu.pursue.top/unreal_audio_sourceeffect_eq.png)

有了 Source Effect Preset 还需要一个 Source Effect Preset Chain，将这块均衡效果器串联进来，右键资产面板创建，将均衡效果器添加到 Chain 数组中：

![SourceEffectChain](https://hexo.qiniu.pursue.top/unreal_audio_sourceeffectchain.png)

最后在 Sound Wave 详情页中挂载效果链保存：

![Attach SourceEffectChain to SoundWave](https://hexo.qiniu.pursue.top/unreal_audio_add_sourceeffectchain.png)

运行即可播放挂载了均衡效果器的音频效果，运行时效果器参数可以动态调整，可以调节频段感受下是否生效。

## Attenuation

Attenuation 是音频空间化的关键配置资产，创建资产后同样也可以选择配置到 Sound Wave 还是 Audio Component。如果是想同一配置一组音源应用同一套衰减参数，就配置到 Sound Wave，如果个别 Audio Component 想用这个衰减配置覆盖掉音源的衰减配置则配置到 Audio Component 上。创建好后双击打开衰减配置详情：

![SourceAttenuation Detail](https://hexo.qiniu.pursue.top/unreal_audio_sourceattenuation_detail.png)

Attenuation 的可配置项，文档 [音效衰减](https://dev.epicgames.com/documentation/unreal-engine/sound-attenuation-in-unreal-engine) 中已经有详细的介绍，这里简单总结一下：
* Attenuation (Volume)：听者根据与音源距离的远近衰减音量，可指定衰减区域的形状、对应形状的边界参数以及衰减函数，是比较基础的声音空间化处理，听者可以借此判断音源的远近，在我们公司的引擎里是有实现的，比较简单。
* Attenuation (Spatialization)：如果说上一个设置是判断音源的远近，那这一项则是通过听者与音源的位置和朝向计算不同声道下的音频差异表现，听者可以借助声音判断音源的具体位置。Unreal Audio 提供的默认空间化算法是 Panning 平移。
* Attenuation (Air Absorption)：随着距离的变化，空气对声音的吸收效果，高频比低频要衰减的更快，这里的参数主要配置距离、高低频衰减阈值和衰减函数，通过高低通滤波器模拟空气对音源中高低频的吸收效果。
* Attenuation (Focus)：这个配置就有意思了，模拟的是人耳的“鸡尾酒会效应”，指人的一种听力选择能力，在这种情况下，注意力集中在某一个人的谈话之中而忽略背景中其他的对话或噪音。该效应揭示了人类听觉系统中令人惊奇的能力，使我们可以在噪声中谈话。Unreal Engine 将这种听力选择能力简化并建模，规定了正前方为听力选择区，支持设置两个角度范围，定义了聚焦区域内外的音量、距离和优先级的衰减和增益，在 RPG、枪战、恐怖类游戏中比较常用。
* Attenuation (Reverb)：配置空间化的声音发送到混响效果的量级，如果在场景中添加了 Audio Volume，这个选项一定要打开才有效果。可以定义混响发送的方法，以及最大最小距离和对应的量级。
* Attenuation (Occlusion)：配置音频被遮挡的情况下的衰减参数，音源处会向听者发出射线检测障碍物，将音频按参数中的衰减音量、低通截止频率和差值时间来计算衰减，但 Unreal 默认没有考虑不同材质对声音的吸收效果差异。
* Attenuation (Priority)：支持根据距离配置声音的优先级。音频引擎（Audio Mixer）能同时处理的“并发语音数”是有限的（默认为 32 或 64），当场景中同时存在大量声音（例如战场上的爆炸、枪声、脚步声、环境音等）时，音频引擎会面临资源上限。这时，优先级设置就决定了哪些声音会被保留，哪些声音会被剔除或静音。
* Attenuation (Submix)：一直在困惑如果这里的 submix 挂载一个混响效果器，那 submix 的发送量不是跟上面 Attenuation (Reverb) 中的发送量冲突了。问了下 AI 发现 Attenuation (Reverb) 配置是与 Audio Volume 配套使用的，如果 Audio Volume 挂载了混响效果，可能会自动创建一个 submix 处理混响计算，Attenuation (Reverb) 的配置决定向这个自动生成的 submix 的音频发送量。而 Attenuation (Submix) 是新版本推荐的做法，灵活性较高。
* Attenuation (Source Data Override)：看文档介绍感觉是将场景信息和音频数据给到三方插件计算空间化再回写。
* Attenuation (AudioLink)：可以挂载外部音频引擎插件，比如 Wwise。

运行项目，会发现声音会根据听者和音源距离衰减音量，根据听者方位调整各声道的音频表现，让听者可以根据声音辨别音源位置。

## Audio Volume

设置好了空间化参数，我们尝试给场景中加一个混响效果。添加混响的方式有多种，空间混响旧版本使用 Audio Volume 配合 Attenuation 中的 Reverb 配置，新版本则推荐用 Audio Gameplay Volume 配合挂载混响效果器的 submix。这里我们为了了解 Unreal Engine 音频设计思路的演变，先使用 Audio Volume 创建空间混响效果。首先在场景中创建一个 Audio Volume，Blush Shape 使用默认的 Box，调整宽高把整个场景包裹起来，保证听者时刻处在混响范围内，接着创建一个 Revert Effect，挂载在 Audio Volume 上：

![AudioVolume](https://hexo.qiniu.pursue.top/unreal_audio_audiovolume.png)

打开 Attenuation 详情页，确保 Reverb 选项中的开关被勾选，为了确保能清晰感知到混响效果，将 Reverb Send Method 调整为 Manual，并设置一个较大的值，保证混响发送量不会随听者与音源的距离衰减：

![Attenuation Reverb](https://hexo.qiniu.pursue.top/unreal_audio_attenuation_reverb.png)

运行项目，可以听到一个不会随距离衰减的混响效果。也可以打开 Tools => Audio Insights 窗口查看 submix 的输入状态，下图中可以看到 MasterReverbSubmixDefault 这个子混音会有信号输入，说明 Attenuation 输出的空间化信号参与了混响计算：

![Audio Insights](https://hexo.qiniu.pursue.top/unreal_audio_insights.png)

## Submix

submix 子混音类似于 Cubase、Logic 这种音频工作站的 bus，submix 之间可以互相连接，最终路由到主 submix，混音后输出到监听设备。引擎默认会自带几个内置 submix，除主 submix 外，还有主混响 submix，主 EQ submix，为的是兼容旧版本 Audio Volume 的混响以及 Sound Class Mix 的 EQ 调节，可以在项目设置中音频选项双击查看内置 submix：

![BuiltIn Submix](https://d1iv7db44yhgxn.cloudfront.net/documentation/images/f2318717-777a-4d64-9c04-78efbcb82eff/06-master-submix-default-properties.png)

我们创建一个 Sound Submix，命名 Reverb Submix，用于后面挂载混响效果器。为了排除干扰将之前创建的 Audio Volume 和 Reverb Effect 资产删除。现在要测试一下这个 submix 是否可以将声音路由到主 submix，打开 Sound Wave 详情页，将 Enable Base Submix 关掉，不发送声音到主 submix，同时将 Enable Submix Send 打开，Sound Submix 指定为 Reverb Submix，Send Stage 设置为 Post Distance Attenuation，将空间化计算后的声音发送给 Reverb Submix：

![SoundWave Custom Submix](https://hexo.qiniu.pursue.top/unreal_audio_soundwave_submix.png)

运行项目，听到声音则表示 Reverb Submix 收到了 Sound Wave 的声音并路由给主 submix，可以打开 Audio Insights 同步验证下。

![Submix AudioInsights](https://hexo.qiniu.pursue.top/unreal_audio_submix_audioinsights.png)

但这里有个疑问，根据官网描述可以绕过 Sound Wave 直接在 Attenuation 的 submix 中指定 Reverb Submix，但测试下来法线是没有效果的，暂时没找到原因。

## Submix Effect

创建好了 submix 并且听到 Sound Wave 经过 Reverb Submix 被路由给了主 submix，下一步就可以在 Reverb Submix 上挂载混响效果器。右键资产面板创建 Submix Effect Preset，选择 SubmixEffectReverb。打开 Reverb Submix，将 Submix Effect Preset 添加到 Submix Effect Chain 中：

![Submix Reverb Effect](https://hexo.qiniu.pursue.top/unreal_audio_submixreverbeffect.png)

由于 Reverb Submix 只将干声处理成带有混响湿声，还是需要将 Sound Wave 中 Enable Base Submix 打开，这样是将干声直接发送到主 submix，经过 Revert Submix 处理过的湿声路由到主 submix 与干声混合达到最终混响效果，设置后运行项目即可。

此时观察 Audio Insights，与上面相比，内置的 EQ submix 有音频输入，可能是 Sound Wave 开启 Enable Base Submix 是将音频路由到 EQ submix：

![Submix Reverb Effect AudioInsights](https://hexo.qiniu.pursue.top/unreal_audio_submixreverbeffect_insights.png)

# 小思考

* 空间化配置为什么会配置在音源上，按现实环境中的声音反射规律，空间化的计算应该与遮挡、传播介质等因素息息相关，而不是发声体本身决定的。
* Attenuation (Reverb) 和 Attenuation (Submix) 在挂载混响 submix 时是否是冲突的。
* Unreal Audio 音频模块有些历史包袱导致使用时有些混乱，有些觉得设计不合理的地方其实是为了兼容老版本的使用，好在文档写的还算详细，分析代码时也要多思考鉴别。

# 后记

一个下午的时间又把整个流程捋了一遍，发现还是有细节比较模糊，结合文档和 Gemini AI 算是搞清了大部分的疑惑，感觉对 Unreal Engine 音频的设计理念的理解又深入了一小步。