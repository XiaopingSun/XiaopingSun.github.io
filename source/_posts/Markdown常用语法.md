---
title: Hexo Markdown常用语法总结
date: 2021-09-15 18:04:07
index_img: https://hexo.qiniu.pursue.top/1200px-Markdown-mark.svg.png
categories:
    - 工具
tags:
    - Markdown
sticky: 100
---

# 基础语法
## 字体
### 标题
- 使用底线的语法
```
我是一级标题
=========
```
  或
```
我是二级标题
---------
```
> 注：这种语法只支持两级标题

- 使用#的语法（推荐）
```
# 我是一级标题
## 我是二级标题
### 我是三级标题
#### 我是四级标题  
##### 我是五级标题
###### 我是六级标题
```
> 注：这种语法只支持六级标题

### 粗体和斜体
- 粗体格式的语法如下
```
**加粗内容**（推荐）
```
或
```
__加粗内容__
```
- 斜体格式的语法如下
```
*斜体内容*（推荐）
```
或
```
_斜体内容_
```

## 段落与换行
```
片段1[空格][空格][回车]
片段2
```
片段1  
片段2

## 分割线
```
星号
***
* * *
*********
减号
---
- - -
---------
下划线
___
_ _ _
_________
```
星号

***
* * *
*********

横杠

---
- - -
---------

下划线

___
_ _ _
_________

## 删除线
```
~~被删除的文字~~
```
~~被删除的文字~~

## 下划线
```
<u>下划线文字</u>
```
<u>下划线文字</u>

## 转义
- 语法如下
```
\特殊符号
```
- 特殊符号如下
```
\   反斜线
`   反引号
*   星号
_   下划线
{}  花括号
[]  方括号
()  小括号
#   井字号
+   加号
-   减号
.   英文句点
!   感叹号
```
- Example:
```
\*\* 正常显示星号 \*\* 
```
\*\* 正常显示星号 \*\* 

## 表情符号
```
:smile:
:laughing:
:clap:
```
:smile:
:laughing:
:clap:

其他表情符号参考[Markdown Emoji表情语法速查表](https://sunhwee.com/posts/a927e90e.html)

## 列表
### 无序列表
```
* 第一项
* 第二项
* 第三项

+ 第一项
+ 第二项
+ 第三项

- 第一项
- 第二项
- 第三项
```
* 第一项
* 第二项
* 第三项

+ 第一项
+ 第二项
+ 第三项

- 第一项
- 第二项
- 第三项

### 有序列表
```
1. 第一项
2. 第二项
3. 第三项
```
1. 第一项
2. 第二项
3. 第三项

### 嵌套列表
```
- 第一项
    1. 第一子项
    2. 第二子项
    3. 第三子项
- 第二项
- 第三项
```
- 第一项
    1. 第一子项
    2. 第二子项
    3. 第三子项
- 第二项
- 第三项

```
1. 第一项
    - 第一子项
    - 第二子项
    - 第三子项
2. 第二项
3. 第三项
```
1. 第一项
    - 第一子项
    - 第二子项
    - 第三子项
2. 第二项
3. 第三项

## 链接
### 文字链接
```
在日常工作中我们经常使用的网址有[Google](https://www.google.com/)、[Github](https://github.com/)和[Stack Overflow]（https://stackoverflow.com/）
```
在日常工作中我们经常使用的网址有[Google](https://www.google.com/)、[Github](https://github.com/)和[Stack Overflow](https://stackoverflow.com/)

### 网址链接
```
博客地址<https://pursue.top/>
```
博客地址<https://pursue.top/>
> 注: 扩展语法GFM中<>可省略

## 图片
### 图片链接
```
![个人头像](https://qcdn-z1.qiniu.pursue.top/540%E9%98%BF%E6%96%B9.png)  
```
![个人头像](https://qcdn-z1.qiniu.pursue.top/540%E9%98%BF%E6%96%B9.png)  

### 图片标签
```
<img src="https://qcdn-z1.qiniu.pursue.top/540%E9%98%BF%E6%96%B9.png" width="50%">  
```
<img src="https://qcdn-z1.qiniu.pursue.top/540%E9%98%BF%E6%96%B9.png" width="50%">  

## 支持的HTML元素
```
使用 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Del</kbd> 重启电脑 
```
使用 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Del</kbd> 重启电脑 

## 引用与区块
### 引用
```
> 这是一个引用
```
> 这是一个引用

### 区块
- 区块嵌套
```
> 第一层
>> 第二层
>>> 第三层
>>>> 第四层
```
> 第一层
> > 第二层
> > > 第三层
> > >
> > > > 第四层

- 区块中使用列表
```
> 1. 第一项
> 2. 第二项
> - 第一项
> - 第二项
> - 第三项
```
> 1. 第一项
> 2. 第二项
> - 第一项
> - 第二项
> - 第三项

- 列表中使用区块
```
1. 第一项
    > 菜鸟教程
    > > 学的不仅是技术
    > >
    > > > 更是梦想
2. 第二项
```
1. 第一项
    > 菜鸟教程
    > > 学的不仅是技术
    > >
    > > > 更是梦想
2. 第二项

## fluid 主题便签
在 markdown 中加入如下的代码来使用便签：
```
{% note success %}
文字 或者 'markdown' 均可
{% endnote %}
```

或者使用 HTML 形式：
```
<p class="note note-primary">标签</p>
```

可选便签：
{% note primary %}
primary
{% endnote %}

{% note secondary %}
secondary
{% endnote %}

{% note success %}
success
{% endnote %}

{% note danger %}
danger
{% endnote %}

{% note warning %}
warning
{% endnote %}

{% note info %}
info
{% endnote %}

{% note light %}
light
{% endnote %}

## 表格
### 表格格式
```
| 序号 | 标题 | 网址 |
| ------ | ------ | ------ |
| 01 | 博客 | https://pursue.top/ |
| 02 | 微博 | https://weibo.com/u/2270909331 |
```
| 序号 | 标题 | 网址 |
| ------ | ------ | ------ |
| 01 | 博客 | https://pursue.top/ |
| 02 | 微博 | https://weibo.com/u/2270909331 |

### 表格内使用其他标记
```
| 序号 | 标题 | 网址 |
| ------ | ------ | ------ |
| *01* | [博客](https://pursue.top/) | https://pursue.top/ |
| **02** | [微博](https://weibo.com/u/2270909331) | https://weibo.com/u/2270909331 |
```
| 序号 | 标题 | 网址 |
| ------ | ------ | ------ |
| *01* | [博客](https://pursue.top/) | https://pursue.top/ |
| **02** | [微博](https://weibo.com/u/2270909331) | https://weibo.com/u/2270909331 |


## 代码
### 行内代码
```
`Hello, world!`
```
`Hello, world!`

### 代码块
- Tab或4个空格开头的代码块
```
[Tab]int main(int argc, char * argv[]) {
				printf("Hello, World!");
				return 0;
		};
```

- 符号包裹的代码块（推荐）
~~~
```
int main(int argc, char * argv[]) {
	printf("Hello, World!");
	return 0;
};
```
~~~
或
```
~~~
int main(int argc, char * argv[]) {
	printf("Hello, World!");
	return 0;
};
~~~
```

- 语法高亮（C语言为例）
~~~
``` c
int main(int argc, char * argv[]) {
	printf("Hello, World!");
	return 0;
};
```
~~~

- 实际效果
``` c
int main(int argc, char * argv[]) {
	printf("Hello, World!");
	return 0;
};
```

# 数学公式

To Do

# 流程图表

To Do