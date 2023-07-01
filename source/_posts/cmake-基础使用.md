---
title: cmake 基础使用
date: 2022-07-09 23:58:46
index_img: https://hexo.qiniu.pursue.top/cmake.jpeg
banner_img:
categories: 编译
tags: cmake
sticky:
---

# 前言

本文是一篇学习 cmake 的笔记，主要内容来自 cmake 官网的 [教程](https://cmake.org/cmake/help/latest/guide/tutorial/)。

# 环境配置

Mac 环境下推荐使用 brew 安装 cmake：

```shell
brew install cmake
```

# cmake 使用

## step 1 一个基础的入门小例子

### 编译和运行

首先创建一个项目文件夹 tutorial：

```shell
mkdir tutorial && cd tutorial
```

在当前目前目录创建源代码文件 tutorial.cxx，提供 main 函数调用系统 sqrt 函数计算平方根，具体内容如下：

```c
// A simple program that computes the square root of a number
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>

int main(int argc, char* argv[])
{
  if (argc < 2) {
    std::cout << "Usage: " << argv[0] << " number" << std::endl;
    return 1;
  }

  // convert input to double
  const double inputValue = atof(argv[1]);

  // calculate square root
  const double outputValue = sqrt(inputValue);
  std::cout << "The square root of " << inputValue << " is " << outputValue
            << std::endl;
  return 0;
}
```

使用 cmake 的核心是要编写 CMakeLists.txt 文件，所以在当前目录创建 CMakeLists.txt，输入以下三行内容：

```shell
cmake_minimum_required(VERSION 3.10)

# set the project name
project(Tutorial)

# add the executable
add_executable(Tutorial tutorial.cxx)
```

这三行代码使用的是小写风格，大写、小写和大小写混合对 cmake 来说都是支持的。

- cmake_minimum_required() 指定使用 cmake 的最小版本。

- project() 设置项目名称。

- add_executable() 将资源编译成可执行文件。

为了将 cmake 编译产生的临时文件和源代码文件分开，在当前目录下创建一个 build 文件夹存放编译结果：

```shell
mkdir build && cd build
```

在 build 目录下执行 cmake，这一步是 cmake 根据当前环境生成 Makefile：

```shell
cmake ..
```

执行后的目录结构：

```shell
.
├── CMakeLists.txt
├── build
│   ├── CMakeCache.txt
│   ├── CMakeFiles
│   ├── Makefile
│   └── cmake_install.cmake
└── tutorial.cxx
```

有了 Makefile，接下来可以执行编译和链接了：

```shell
cmake --build .
```

或者直接使用 make：

```shell
make
```

执行完成后，当前 build 目录下生成了可执行文件 Tutorial，运行 Tutorial 并传入参数，控制台输出了预期的结果：

```shell
./Tutorial 16
The square root of 16 is 4
```

### 添加版本号和配置头文件

项目的版本号一般可以定义在源代码中，但使用 CMakeLists.txt 会更灵活一些，首先修改 CMakeLists.txt 文件使用 project() 命令设置项目名称和版本号：

```shell
cmake_minimum_required(VERSION 3.10)

# set the project name and version
project(Tutorial VERSION 1.0)
```

然后使用 configure_file 命令将 cmake 配置转换成 .h 文件：

```shell
configure_file(TutorialConfig.h.in TutorialConfig.h)
```

转换后的 .h 文件会被保存到可执行文件所在目录，为了使用它，需要将路径添加到索引目录中：

```shell
target_include_directories(Tutorial PUBLIC
                           "${PROJECT_BINARY_DIR}"
                           )
```

关键字 PUBLIC 的作用参考 [这里](https://zhuanlan.zhihu.com/p/82244559)。PROJECT_BINARY_DIR 是 cmake 内置的一个宏定义，一般常用的有两个 PROJECT_SOURCE_DIR 和 PROJECT_BINARY_DIR。PROJECT_SOURCE_DIR 表示项目源文件所在目录，即根目录，PROJECT_BINARY_DIR 表示编译输出的二进制文件所在目录，即当前项目的 build 目录。

接下来需要提供 cmake 用于转换 .h 的模板文件，在项目的根目录下创建 TutorialConfig.h.in，并输入如下内容：

```shell
// the configured options and settings for Tutorial
#define Tutorial_VERSION_MAJOR @Tutorial_VERSION_MAJOR@
#define Tutorial_VERSION_MINOR @Tutorial_VERSION_MINOR@
```

最后一步，在 tutorial.cxx 中添加这两个宏的打印，查看是否生效：

```c
...
  if (argc < 2) {
    // report version
    std::cout << argv[0] << " Version " << Tutorial_VERSION_MAJOR << "."
              << Tutorial_VERSION_MINOR << std::endl;
    std::cout << "Usage: " << argv[0] << " number" << std::endl;
    return 1;
  }
...
```

重新回到 build 文件夹执行 cmake 命令，可以看到控制台输出了在 CMakeLists.txt 中配置的版本信息：

```shell
./Tutorial
./Tutorial Version 1.0
Usage: ./Tutorial number
```

我们对这个过程做下分析：

首先在 CMakeLists.txt 配置 VERSION 1.0 后，cmake 会以版本号的小数点为边界生成两个宏定义，即 Tutorial_VERSION_MAJOR = 1、Tutorial_VERSION_MINOR = 0，在执行 configure 时，cmake 将 TutorialConfig.h.in 中的 @Tutorial_VERSION_MAJOR@ 和 @Tutorial_VERSION_MINOR@ 替换成具体的值并生成 TutorialConfig.h 保存在 build 目录下，我们的源文件中引入 TutorialConfig.h，在预编译时 Tutorial_VERSION_MAJOR 和 Tutorial_VERSION_MINOR 被替换成具体的数值，在运行时被打印出来。

### 定义 C++ 标准

现在让我们给源代码添加一些 C++11 的特性，使用 `std::stod` 替换 'atof'，同时，需要移除 `#include <cstdlib>`：

```c
const double inputValue = std::stod(argv[1]);
```

接着在 CMakeLists.txt 中定义 C++ 标准：

```shell
# specify the C++ standard
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED True)
```

{% note warning %}

注意：需要保证 CMAKE_CXX_STANDARD 的声明在 add_executable()  执行之前。

{% endnote %}

重新执行 cmake 并运行可执行程序，控制台输出预期结果：

```shell
./Tutorial 16
The square root of 16 is 4
```

## step 2 尝试链接一个库

现在尝试给程序链接一个库，这个库包含我们自定义的计算平方根的函数，可执行程序用这个自定义函数替换系统函数。

首先在根目录下创建 MathFunctions 存放库的头文件 MathFunctions.h 和源文件 mysqrt.cxx，源文件中有一个函数 mysqrt 提供计算平方根的功能。

MathFunctions.h：

```c
double mysqrt(double x);
```

mysqrt.cxx:

```c
#include "MathFunctions.h"
#include <stdio.h>

// a hack square root calculation using simple operations
double mysqrt(double x)
{
  if (x <= 0) {
    return 0;
  }

  double result;
  double delta;
  result = x;

  // do ten iterations
  int i;
  for (i = 0; i < 10; ++i) {
    if (result <= 0) {
      result = 0.1;
    }
    delta = x - (result * result);
    result = result + 0.5 * delta / result;
    fprintf(stdout, "Computing sqrt of %g to be %g\n", x, result);
  }
  return result;
}
```

在 MathFunctions 目录创建 CMakeLists.txt，并输入如下内容：

```shell
add_library(MathFunctions mysqrt.cxx)
```

add_library() 命令用于将源文件编译成库文件，此例中是将 mysqrt.cxx 编译成 libMathFunctions.a 文件。

接下来需要在根目录的 CMakeLists.txt 添加 MathFunctions 的子目录，并添加库函数头文件的索引：

```shell
# add the MathFunctions library
add_subdirectory(MathFunctions)

# add the executable
add_executable(Tutorial tutorial.cxx)

target_link_libraries(Tutorial PUBLIC MathFunctions)

# add the binary tree to the search path for include files
# so that we will find TutorialConfig.h
target_include_directories(Tutorial PUBLIC
                          "${PROJECT_BINARY_DIR}"
                          "${PROJECT_SOURCE_DIR}/MathFunctions"
                          )
```

- add_subdirectory() 用于执行子目录的 CMakeLists.txt
- target_link_libraries() 用于链接库文件
- target_include_directories() 将库文件的头文件索引添加进来

最后在 tutorial.cxx 中引入 MathFunctions.h 的头文件，并将系统函数 sqrt() 替换成自定义的 mysqrt()：

```c
// A simple program that computes the square root of a number
#include <cmath>
// #include <cstdlib>
#include <iostream>
#include <string>
#include "TutorialConfig.h"
#include "MathFunctions.h"

int main(int argc, char* argv[])
{
  if (argc < 2) {
    // report version
    std::cout << argv[0] << " Version " << Tutorial_VERSION_MAJOR << "."
              << Tutorial_VERSION_MINOR << std::endl;
    std::cout << "Usage: " << argv[0] << " number" << std::endl;
    return 1;
  }

  // convert input to double
  // const double inputValue = atof(argv[1]);
  const double inputValue = std::stod(argv[1]);

  // calculate square root
  // const double outputValue = sqrt(inputValue);
  const double outputValue = mysqrt(inputValue);
  std::cout << "The square root of " << inputValue << " is " << outputValue
            << std::endl;
  return 0;
}
```

cmake 重新编译后执行 Tutorial 程序，控制台输出显示成功调用了自定义的库函数：

```shell
./Tutorial 16
Computing sqrt of 16 to be 8.5
Computing sqrt of 16 to be 5.19118
Computing sqrt of 16 to be 4.13666
Computing sqrt of 16 to be 4.00226
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
The square root of 16 is 4
```

现在我们通过 cmake 的一个 option 配置来决定是否编译链接 MathFunctions 库，首先在根目录的 CMakeLists.txt 中添加 option 命令：

```shell
option(USE_MYMATH "Use tutorial provided math implementation" ON)
```

接下来使用 if 判断 USE_MYMATH 如果是打开状态，则编译并链接 MathFunctions：

```shell
if(USE_MYMATH)
  add_subdirectory(MathFunctions)
  list(APPEND EXTRA_LIBS MathFunctions)
  list(APPEND EXTRA_INCLUDES "${PROJECT_SOURCE_DIR}/MathFunctions")
endif()

# add the executable
add_executable(Tutorial tutorial.cxx)

target_link_libraries(Tutorial PUBLIC ${EXTRA_LIBS})

# add the binary tree to the search path for include files
# so that we will find TutorialConfig.h
target_include_directories(Tutorial PUBLIC
                           "${PROJECT_BINARY_DIR}"
                           ${EXTRA_INCLUDES}
                           )
```

list(APPEND ...) 命令用于将新的 element 添加到 list 中，我们定义两个 list 变量 EXTRA_LIBS 和 EXTRA_INCLUDES 分别用于存放链接库和库的头文件索引路径，之后使用 target_link_libraries() 和 target_include_directories() 传入这两个变量即可链接库文件和库的头文件。

OK目前到这里，我们已经在 cmake 中使用一个变量的开关来决定是否编译链接 MathFunctions 库，那如何在源代码中判断是否编译了 MathFunctions 呢？可以借助 step 1 中使用的 configure_file() 命令，在根目录下的 TutorialConfig.h.in 文件中添加如下代码：

```shell
#cmakedefine USE_MYMATH
```

借助 configure_file() 生成的 Tutorial.h 文件中会出现这样一行代码：

```c
#define USE_MYMATH
```

因此我们就可以在源文件中引用 Tutorial.h 并使用 USE_MYMATH 这个宏定义了，在 tutorial.cxx 中引入头文件的位置和计算平方根的位置通过宏来判断使用自定义函数还是系统函数：

```c
...
#ifdef USE_MYMATH
  #include "MathFunctions.h"
#endif
...

...
// calculate square root
#ifdef USE_MYMATH
  const double outputValue = mysqrt(inputValue);
#else
  const double outputValue = sqrt(inputValue);
#endif
...
```

cmake 重新生成编译，执行 Tutorial 发现结果符合预期：

```shell
./Tutorial 16
Computing sqrt of 16 to be 8.5
Computing sqrt of 16 to be 5.19118
Computing sqrt of 16 to be 4.13666
Computing sqrt of 16 to be 4.00226
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
The square root of 16 is 4
```

如果不想编译链接 MathFunctions，只需将 CMakeLists.txt 中 USE_MYMATH 的 option 设置为 OFF，重新 cmake 生成编译即可，或者在执行 cmake 生成时添加参数将 option 关闭：

```shell
cmake .. -DUSE_MYMATH=OFF
```

此时查看生成的 Tutorial.h 文件，发现 USE_MYMATH 并没有被定义：

```c
cat TutorialConfig.h
// the configured options and settings for Tutorial
#define Tutorial_VERSION_MAJOR 1
#define Tutorial_VERSION_MINOR 0

/* #undef USE_MYMATH */
```

## step 3 给链接库添加使用要求

使用要求（Usage Requirements）可以更好地控制库或可执行文件的链接和头文件索引，也可以更好地控制 CMake 中目标的属性传递。利用“使用要求”的主要命令有：

- [target_compile_definitions()](https://cmake.org/cmake/help/latest/command/target_compile_definitions.html#command:target_compile_definitions)
- [target_compile_options()](https://cmake.org/cmake/help/latest/command/target_compile_options.html#command:target_compile_options)
- [target_include_directories()](https://cmake.org/cmake/help/latest/command/target_include_directories.html#command:target_include_directories)
- [target_link_libraries()](https://cmake.org/cmake/help/latest/command/target_link_libraries.html#command:target_link_libraries)

观察我们之前写过的项目，MathFunctions 的头文件 MathFunctions.h 只有在主工程源文件 tutorial.cxx 中使用，而 MathFunctions 库本身并没有使用，所以这里可以定义一个“使用要求”，即 INTERFACE。

INTERFACE 意味着消费者（customer）需要使用但生产者（producer）不需要使用的东西，因此我们在 MathFunctions 文件夹下的 CMakeLists.txt 文件中添加如下内容：

```shell
target_include_directories(MathFunctions
          INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}
          )
```

CMAKE_CURRENT_SOURCE_DIR 是当前层的 CMakeLists.txt 对应资源文件所在目录，这行命令告知 cmake 当前目录下的头文件我当前层的源代码不需要使用，上层需要使用。添加这一行后，就可以将根目录 CMakeLists.txt 文件中对 MathFunctions 头文件的引用去掉了：

```shell
if(USE_MYMATH)
  add_subdirectory(MathFunctions)
  list(APPEND EXTRA_LIBS MathFunctions)
  # list(APPEND EXTRA_INCLUDES "${PROJECT_SOURCE_DIR}/MathFunctions")
endif()

# add the executable
add_executable(Tutorial tutorial.cxx)

target_link_libraries(Tutorial PUBLIC ${EXTRA_LIBS})

# add the binary tree to the search path for include files
# so that we will find TutorialConfig.h
target_include_directories(Tutorial PUBLIC
                           "${PROJECT_BINARY_DIR}"
                           # ${EXTRA_INCLUDES}
                           )
```

重新 cmake 生成编译，运行 Tutorial 查看输出正常：

```shell
./Tutorial 16
Computing sqrt of 16 to be 8.5
Computing sqrt of 16 to be 5.19118
Computing sqrt of 16 to be 4.13666
Computing sqrt of 16 to be 4.00226
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
The square root of 16 is 4
```

## step 4 安装和测试

### 安装规则

安装这一步比较简单，对于我们之前的项目，应用程序需要安装可执行程序和配置的头文件，MathFunctions 库需要安装库的二进制文件和库的头文件，安装的本质其实就是将编译出的文件复制到安装目录下。

首先我们在 MathFunctions 目录下的 CMakeLists.txt 中添加如下内容：

```shell
install(TARGETS MathFunctions DESTINATION lib)
install(FILES MathFunctions.h DESTINATION include)
```

然后在根目录的 CMakeLists.txt 中添加如下内容：

```shell
install(TARGETS Tutorial DESTINATION bin)
install(FILES "${PROJECT_BINARY_DIR}/TutorialConfig.h"
  DESTINATION include
  )
```

最后我们进入 build 目录重新 cmake 生成编译，运行 install 命令：

```shell
cmake --install .
-- Install configuration: ""
-- Installing: /usr/local/bin/Tutorial
-- Installing: /usr/local/include/TutorialConfig.h
-- Installing: /usr/local/lib/libMathFunctions.a
-- Installing: /usr/local/include/MathFunctions.h
```

Mac 系统默认的 DESTINATION 路径是 /usr/local/，cmake 在该路径下分别安装了二进制文件和头文件。

cmake 也可以通过 prefix 参数指定安装目录：

```
cmake --install . --prefix="/Users/joker/Desktop/install"
-- Install configuration: ""
-- Installing: /Users/joker/Desktop/install/bin/Tutorial
-- Installing: /Users/joker/Desktop/install/include/TutorialConfig.h
-- Installing: /Users/joker/Desktop/install/lib/libMathFunctions.a
-- Installing: /Users/joker/Desktop/install/include/MathFunctions.h
```

### 测试支持

接下来让我们测试我们的应用程序。在顶级`CMakeLists.txt` 文件的末尾，我们可以启用测试，然后添加一些基本测试来验证应用程序是否正常工作。

```shell
enable_testing()

# does the application run
add_test(NAME Runs COMMAND Tutorial 25)

# does the usage message work?
add_test(NAME Usage COMMAND Tutorial)
set_tests_properties(Usage
  PROPERTIES PASS_REGULAR_EXPRESSION "Usage:.*number"
  )

# define a function to simplify adding tests
function(do_test target arg result)
  add_test(NAME Comp${arg} COMMAND ${target} ${arg})
  set_tests_properties(Comp${arg}
    PROPERTIES PASS_REGULAR_EXPRESSION ${result}
    )
endfunction()

# do a bunch of result based tests
do_test(Tutorial 4 "4 is 2")
do_test(Tutorial 9 "9 is 3")
do_test(Tutorial 5 "5 is 2.236")
do_test(Tutorial 7 "7 is 2.645")
do_test(Tutorial 25 "25 is 5")
do_test(Tutorial -25 "-25 is (-nan|nan|0)")
do_test(Tutorial 0.0001 "0.0001 is 0.01")
```

第一个测试只是验证应用程序是否运行，没有段错误或以其他方式崩溃，并且返回值为零。这是 CTest 测试的基本形式。

下一个测试使用 PASS_REGULAR_EXPRESSION 属性来验证测试的输出是否包含某些字符串。在这种情况下，验证在提供不正确数量的参数时是否打印了使用消息。

最后，我们有一个调用函数 do_test 来运行应用程序并验证计算的平方根对于给定的输入是否正确。对于 的每次调用 do_test，都会将另一个测试添加到项目中，其中包含名称、输入和基于传递的参数的预期结果。

重建应用程序，然后 cd 到二进制目录并运行 ctest 可执行文件：和。对于多配置生成器（例如 Visual Studio），必须使用标志指定配置类型。例如，要在 Debug 模式下运行测试，请使用二进制目录（而不是 Debug 子目录！）。发布模式将从同一位置执行，但使用. 或者，从 IDE构建目标。

`ctest -N``ctest -VV``-C <mode>``ctest -C Debug -VV``-C Release``RUN_TESTS`

## step 5 添加系统能力检测

考虑在项目中添加一些代码，这些代码用于检测目标平台是否包含 log 和 exp 函数，如果平台有 log 和 exp，那么我们将使用它们来计算函数中的平方根。

我们首先在 MathFunctions 目录下的 CMakeLists.txt 中引入 CheckCXXSourceCompiles 模块，并使用 check_cxx_source_compiles() 函数将检测结果写入到 HAVE_LOG 和 HAVE_EXP 两个宏定义中：

```shell
target_include_directories(MathFunctions
          INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}
          )

# does this system provide the log and exp functions?
include(CheckCXXSourceCompiles)
check_cxx_source_compiles("
  #include <cmath>
  int main() {
    std::log(1.0);
    return 0;
  }
" HAVE_LOG)
check_cxx_source_compiles("
  #include <cmath>
  int main() {
    std::exp(1.0);
    return 0;
  }
" HAVE_EXP)
```

如果 log 和 exp 可用，使用 target_compile_definitions() 指定 HAVE_LOG 和 HAVE_EXP 作为 PRIVATE 编译定义：

```shell
if(HAVE_LOG AND HAVE_EXP)
  target_compile_definitions(MathFunctions
                             PRIVATE "HAVE_LOG" "HAVE_EXP")
endif()
```

在 mysqrt.cxx 中添加 HAVE_LOG 和 HAVE_EXP 的判断：

```c
#if defined(HAVE_LOG) && defined(HAVE_EXP)
  double result = std::exp(std::log(x) * 0.5);
  std::cout << "Computing sqrt of " << x << " to be " << result
            << " using log and exp" << std::endl;
#else
  double result = x;
#endif
```

重新编译运行 Tutorial，控制台输出符合预期，使用系统的 log 和 exp 函数计算平方根：

```shell
./Tutorial 16
Computing sqrt of 16 to be 4 using log and exp
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
Computing sqrt of 16 to be 4
The square root of 16 is 4
```

## step 6 添加自定义命令和生成文件

现在我们通过 cmake 的自定义命令动态生成一个包含计算平方根函数的文件，首先删除掉 step 5 中 log 和 exp 函数检查的相关代码，在 MathFunctions 目录下创建一个源文件 MakeTable.cxx 来生成文件，main函数中在传入路径上创建文件并注入计算平方根的数组代码：

```c
// A simple program that builds a sqrt table
#include <cmath>
#include <fstream>
#include <iostream>

int main(int argc, char* argv[])
{
  // make sure we have enough arguments
  if (argc < 2) {
    return 1;
  }

  std::ofstream fout(argv[1], std::ios_base::out);
  const bool fileOpen = fout.is_open();
  if (fileOpen) {
    fout << "double sqrtTable[] = {" << std::endl;
    for (int i = 0; i < 10; ++i) {
      fout << sqrt(static_cast<double>(i)) << "," << std::endl;
    }
    // close the table with a zero
    fout << "0};" << std::endl;
    fout.close();
  }
  return fileOpen ? 0 : 1; // return 0 if wrote the file
}
```

接着在 MathFunctions 目录 CMakeLists.txt 文件顶部添加如下内容，将 MakeTable.cxx 编译成可执行文件：

```shell
add_executable(MakeTable MakeTable.cxx)
```

然后我们添加一个自定义命令，通过执行命令，借助 MakeTable 可执行文件生成 Table.h:

```shell
add_custom_command(
  OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/Table.h
  COMMAND MakeTable ${CMAKE_CURRENT_BINARY_DIR}/Table.h
  DEPENDS MakeTable
  )
```

接下来我们要让 CMake 知道 mysqrt.cxx 依赖于生成的文件 Table.h，这是通过将生成的 Table.h 添加到库 MathFunctions 的源列表中来完成的：

```shell
add_library(MathFunctions
            mysqrt.cxx
            ${CMAKE_CURRENT_BINARY_DIR}/Table.h
            )
```

我们还必须将当前二进制目录添加到包含目录列表中，以便 Table.h 可以被 mysqrt.cxx 索引到：

```shell
target_include_directories(MathFunctions
          INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}
          PRIVATE ${CMAKE_CURRENT_BINARY_DIR}
          )
```

最后需要修改 mysqrt 函数：

```shell
double mysqrt(double x)
{
  if (x <= 0) {
    return 0;
  }

  // use the table to help find an initial value
  double result = x;
  if (x >= 1 && x < 10) {
    std::cout << "Use the table to help find an initial value " << std::endl;
    result = sqrtTable[static_cast<int>(x)];
  }

  // do ten iterations
  for (int i = 0; i < 10; ++i) {
    if (result <= 0) {
      result = 0.1;
    }
    double delta = x - (result * result);
    result = result + 0.5 * delta / result;
    std::cout << "Computing sqrt of " << x << " to be " << result << std::endl;
  }

  return result;
}
```

重新 cmake 生成编译，在 MathFunctions 编译目录下生成了 Table.h，执行 Tutorial 程序，输出符合预期：

```shell
./Tutorial 9
Use the table to help find an initial value
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
Computing sqrt of 9 to be 3
The square root of 9 is 3
```

## step 7 打包安装程序

接下来假设我们想将项目分发给其他人，以便他们可以使用它。我们希望在各种平台上提供二进制和源代码分发。这与我们之前进行的安装有点不同，我们正在安装从源代码构建的二进制文件。在此示例中，我们将构建支持二进制安装和包管理功能的安装包。为此，我们将使用 CPack 创建特定于平台的安装程序。具体来说，我们需要在顶层 CMakeLists.txt 文件的底部添加几行:

```shell
include(InstallRequiredSystemLibraries)
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/License.txt")
set(CPACK_PACKAGE_VERSION_MAJOR "${Tutorial_VERSION_MAJOR}")
set(CPACK_PACKAGE_VERSION_MINOR "${Tutorial_VERSION_MINOR}")
set(CPACK_SOURCE_GENERATOR "TGZ")
include(CPack)
```

这就是它的全部。我们首先引入 InstallRequiredSystemLibraries，该模块将包括当前平台项目所需的任何运行时库。接下来，我们将一些 CPack 变量设置为我们存储该项目的许可证和版本信息的位置。版本信息已在本教程前面设置，并且 License.txt 已包含在此步骤的顶级源目录中。这 CPACK_SOURCE_GENERATOR 变量选择源包的文件格式。

最后我们引入 CPack 模块，它将使用这些变量和当前系统的一些其他属性来设置安装程序。

下一步是以正常的方式构建项目，然后运行  cpack。要构建二进制发行版，请从二进制目录运行：

```shell
cpack
```

要指定生成器，请使用 -G 选项。对于多配置构建，用于 -C 指定配置。例如：

```shell
cpack -G ZIP -C Debug
```

## step 8 添加对测试仪表盘的支持

在之前的 step 已经定义过了一些项目的测试，现在我们只需要将测试跑起来然后提交到仪表盘，为了支持仪表盘我们需要在根目录的 CMakeLists.txt 中引入 CTest 模块：

使用：

```shell
include(CTest)
```

替换：

```
enable_testing()
```

在根目录创建 CTestConfig.cmake 用来定义 CTest 的一些信息：

```shell
set(CTEST_PROJECT_NAME "CMakeTutorial")
set(CTEST_NIGHTLY_START_TIME "00:00:00 EST")

set(CTEST_DROP_METHOD "http")
set(CTEST_DROP_SITE "my.cdash.org")
set(CTEST_DROP_LOCATION "/submit.php?project=CMakeTutorial")
set(CTEST_DROP_SITE_CDASH TRUE)
```

ctest 可执行文件将在运行时读入此文件。要创建一个简单的仪表板，您可以运行 cmake 可执行文件或 cmake-gui 配置项目，但尚未构建它。相反，将目录更改为二叉树，然后运行：

```shell
ctest [-VV] -D Experimental
```

请记住，对于多配置生成器（例如 Visual Studio），必须指定配置类型：

```shell
ctest [-VV] -C Debug -D Experimental
```

或者，从 IDE 构建 Experimental 目标。

ctest 可执行文件将构建和测试项目并将结果提交到 Kitware 的公共仪表板： [https ://my.cdash.org/index.php?project=CMakeTutorial ](https://my.cdash.org/index.php?project=CMakeTutorial)。

## step 9 选择静态或动态库

在本节中将展示 BUILD_SHARED_LIBS 变量是如何影响 add_library() 的默认行为的，为此我们需要在根目录 CMakeList.txt 文件中添加 BUILD_SHARED_LIBS，我们使用 option() 命令，因为它允许用户有选择地控制 ON 和 OFF。

接下来我们将重构 MathFunctions 使其成为一个真正封装 mysqrt 或 sqrt 的库，而不是要求调用代码来实现这个逻辑，这意味着 USE_MYMATH 不会影响 MathFunctions 库的正常编译，而是会控制这个库的行为。

第一步是更新根目录的 CMakeLists.txt：

```shell
cmake_minimum_required(VERSION 3.10)

# set the project name and version
project(Tutorial VERSION 1.0)

# specify the C++ standard
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# control where the static and shared libraries are built so that on windows
# we don't need to tinker with the path to run the executable
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)

# configure a header file to pass the version number only
configure_file(TutorialConfig.h.in TutorialConfig.h)

# add the MathFunctions library
add_subdirectory(MathFunctions)

# add the executable
add_executable(Tutorial tutorial.cxx)
target_link_libraries(Tutorial PUBLIC MathFunctions)
```

现在我们已经让 MathFunctions 这个库总是被编译，我们将需要更新该库的逻辑。因此，MathFunctions 目录下的 CMakeLists.txt 我们需要创建一个SqrtLibrary，它会在 USE_MYMATH 启用时有条件地构建和安装。现在，由于这是一个教程，我们将明确要求 SqrtLibrary 是静态构建的。

最终 MathFunctions 目录下的 CMakeLists.txt 应该如下所示：

```shell
# add the library that runs
add_library(MathFunctions MathFunctions.cxx)

# state that anybody linking to us needs to include the current source dir
# to find MathFunctions.h, while we don't.
target_include_directories(MathFunctions
                           INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}
                           )

# should we use our own math functions
option(USE_MYMATH "Use tutorial provided math implementation" ON)
if(USE_MYMATH)

  target_compile_definitions(MathFunctions PRIVATE "USE_MYMATH")

  # first we add the executable that generates the table
  add_executable(MakeTable MakeTable.cxx)

  # add the command to generate the source code
  add_custom_command(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/Table.h
    COMMAND MakeTable ${CMAKE_CURRENT_BINARY_DIR}/Table.h
    DEPENDS MakeTable
    )

  # library that just does sqrt
  add_library(SqrtLibrary STATIC
              mysqrt.cxx
              ${CMAKE_CURRENT_BINARY_DIR}/Table.h
              )

  # state that we depend on our binary dir to find Table.h
  target_include_directories(SqrtLibrary PRIVATE
                             ${CMAKE_CURRENT_BINARY_DIR}
                             )

  target_link_libraries(MathFunctions PRIVATE SqrtLibrary)
endif()

# define the symbol stating we are using the declspec(dllexport) when
# building on windows
target_compile_definitions(MathFunctions PRIVATE "EXPORTING_MYMATH")

# install rules
set(installable_libs MathFunctions)
if(TARGET SqrtLibrary)
  list(APPEND installable_libs SqrtLibrary)
endif()
install(TARGETS ${installable_libs} DESTINATION lib)
install(FILES MathFunctions.h DESTINATION include)
```

接下来，更新 mysqrt.cxx 以使用 mathfunctions 和 detail 命名空间：

```c
#include <iostream>

#include "MathFunctions.h"

// include the generated table
#include "Table.h"

namespace mathfunctions {
namespace detail {
// a hack square root calculation using simple operations
double mysqrt(double x)
{
  if (x <= 0) {
    return 0;
  }

  // use the table to help find an initial value
  double result = x;
  if (x >= 1 && x < 10) {
    std::cout << "Use the table to help find an initial value " << std::endl;
    result = sqrtTable[static_cast<int>(x)];
  }

  // do ten iterations
  for (int i = 0; i < 10; ++i) {
    if (result <= 0) {
      result = 0.1;
    }
    double delta = x - (result * result);
    result = result + 0.5 * delta / result;
    std::cout << "Computing sqrt of " << x << " to be " << result << std::endl;
  }

  return result;
}
}
}
```

我们还需要对 进行一些更改 tutorial.cxx，使其不再使用 USE_MYMATH：

1. 始终引用 MathFunctions.h
2. 始终使用 mathfunctions::sqrt
3. 不包括 cmath

最后，更新 MathFunctions/MathFunctions.h 使用 dll 导出定义：

```c
#if defined(_WIN32)
#  if defined(EXPORTING_MYMATH)
#    define DECLSPEC __declspec(dllexport)
#  else
#    define DECLSPEC __declspec(dllimport)
#  endif
#else // non windows
#  define DECLSPEC
#endif

namespace mathfunctions {
double DECLSPEC sqrt(double x);
}
```

此时，如果您构建所有内容，您可能会注意到链接失败，因为我们将没有位置无关代码的静态库与具有位置无关代码的库组合在一起。解决方案是显式设置 SqrtLibrary 的目标属性 POSITION_INDEPENDENT_CODE 为 True，与构建类型无关。

```shell
  # state that SqrtLibrary need PIC when the default is shared libraries
  set_target_properties(SqrtLibrary PROPERTIES
                        POSITION_INDEPENDENT_CODE ${BUILD_SHARED_LIBS}
                        )

  target_link_libraries(MathFunctions PRIVATE SqrtLibrary)
```

## step 10 添加生成器表达式

Generator expressions 在构建系统生成期间进行评估，以生成特定于每个构建配置的信息。

Generator expressions 在许多目标属性的上下文中是允许的，例如 LINK_LIBRARIES, INCLUDE_DIRECTORIES，COMPILE_DEFINITIONS 和别的。它们也可以在使用命令填充这些属性时使用，例如 target_link_libraries()，target_include_directories(), target_compile_definitions() 和别的。

Generator expressions 可用于启用条件链接、编译时使用的条件定义、条件包含目录等。条件可以基于构建配置、目标属性、平台信息或任何其他可查询信息。

有不同类型的 generator expressions 包括逻辑、信息和输出表达式。

generator expressions 的一个常见用法是有条件地添加编译器标志，例如语言级别或警告的标志。一个很好的模式是将此信息与 INTERFACE 允许此信息传播的目标相关联。让我们首先构造一个  INTERFACE 目标并指定所需的 C++ 标准级别，11 而不是使用 CMAKE_CXX_STANDARD.

所以下面的代码：

```shell
# specify the C++ standard
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED True)
```

将被替换为：

```shell
add_library(tutorial_compiler_flags INTERFACE)
target_compile_features(tutorial_compiler_flags INTERFACE cxx_std_11)
```

**注意**：接下来的部分将需要更改 cmake_minimum_required() 代码中的用法。即将使用的生成器表达式是在 3.15 中引入的。更新调用以要求更新版本：

```shell
cmake_minimum_required(VERSION 3.15)
```

接下来，我们为项目添加所需的编译器警告标志。由于警告标志因编译器而异，我们使用 COMPILE_LANG_AND_ID 生成器表达式来控制在给定语言和一组编译器 ID 的情况下应用哪些标志，如下所示：

```shell
set(gcc_like_cxx "$<COMPILE_LANG_AND_ID:CXX,ARMClang,AppleClang,Clang,GNU,LCC>")
set(msvc_cxx "$<COMPILE_LANG_AND_ID:CXX,MSVC>")
target_compile_options(tutorial_compiler_flags INTERFACE
  "$<${gcc_like_cxx}:$<BUILD_INTERFACE:-Wall;-Wextra;-Wshadow;-Wformat=2;-Wunused>>"
  "$<${msvc_cxx}:$<BUILD_INTERFACE:-W3>>"
)
```

看看这个，我们看到警告标志被封装在一个 BUILD_INTERFACE 条件中。这样做是为了使我们已安装项目的消费者不会继承我们的警告标志。

## step 11 添加导出配置

在本教程中，我们添加了 CMake 安装项目的库和标头的功能。在此期间 ，我们添加了打包此信息的功能，以便将其分发给其他人。

下一步是添加必要的信息，以便其他 CMake 项目可以使用我们的项目，无论是从构建目录、本地安装还是打包时。

第一步是更新我们的 install(TARGETS) 命令不仅可以指定 DESTINATION，还可以指定 EXPORT. 该 EXPORT 关键字生成一个 CMake 文件，其中包含从安装树导入 install 命令中列出的所有目标的代码。因此，让我们继续通过更新命令来明确 EXPORT 库，如下所示：

```shell
set(installable_libs MathFunctions tutorial_compiler_flags)
if(TARGET SqrtLibrary)
  list(APPEND installable_libs SqrtLibrary)
endif()
install(TARGETS ${installable_libs}
        EXPORT MathFunctionsTargets
        DESTINATION lib)
install(FILES MathFunctions.h DESTINATION include)
```

现在我们已经 MathFunctions 被导出，我们还需要显式安装生成的 MathFunctionsTargets.cmake 文件。这是通过将以下内容添加到顶层的底部来完成的 CMakeLists.txt：

```shell
install(EXPORT MathFunctionsTargets
  FILE MathFunctionsTargets.cmake
  DESTINATION lib/cmake/MathFunctions
)
```

此时您应该尝试运行 CMake。如果一切设置正确，您将看到 CMake 将生成如下错误：

```shell
Target "MathFunctions" INTERFACE_INCLUDE_DIRECTORIES property contains
path:

  "/Users/robert/Documents/CMakeClass/Tutorial/Step11/MathFunctions"

which is prefixed in the source directory.
```

CMake 想说的是，在生成导出信息期间，它将导出一个本质上与当前机器相关联的路径，并且在其他机器上无效。解决方法是更新 MathFunctions target_include_directories()了解它 INTERFACE 在构建目录和安装/包中使用时需要不同的位置。这意味着转换  target_include_directories() 要求 MathFunctions 看起来像：

```shell
target_include_directories(MathFunctions
                           INTERFACE
                            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
                            $<INSTALL_INTERFACE:include>
                           )
```

更新后，我们可以重新运行 CMake 并验证它不再发出警告。

此时，我们已经让 CMake 正确打包了所需的目标信息，但我们仍然需要生成一个 MathFunctionsConfig.cmake，以便 CMake find_package() 命令可以找到我们的项目。所以让我们继续在项目的顶层添加一个新文件，其 Config.cmake.in 内容如下：

配置.cmake.in 

```shell
@PACKAGE_INIT@

include ( "${CMAKE_CURRENT_LIST_DIR}/MathFunctionsTargets.cmake" )
```

然后，要正确配置和安装该文件，请将以下内容添加到顶层的底部 CMakeLists.txt：

CMakeLists.txt 

```shell
install(EXPORT MathFunctionsTargets
  FILE MathFunctionsTargets.cmake
  DESTINATION lib/cmake/MathFunctions
)

include(CMakePackageConfigHelpers)
```

接下来，我们执行 configure_package_config_file(). 此命令将配置提供的文件，但与标准有一些特定差异 configure_file() 方法。@PACKAGE_INIT@ 要正确使用此功能，输入文件除了所需内容外，还应包含一行文本。该变量将替换为将设置值转换为相对路径的代码块。这些新值可以用相同的名称引用，但前面带有 PACKAGE_ 前缀。

```shell
install(EXPORT MathFunctionsTargets
  FILE MathFunctionsTargets.cmake
  DESTINATION lib/cmake/MathFunctions
)

include(CMakePackageConfigHelpers)
# generate the config file that is includes the exports
configure_package_config_file(${CMAKE_CURRENT_SOURCE_DIR}/Config.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/MathFunctionsConfig.cmake"
  INSTALL_DESTINATION "lib/cmake/example"
  NO_SET_AND_CHECK_MACRO
  NO_CHECK_REQUIRED_COMPONENTS_MACRO
  )
```

这 write_basic_package_version_file() 接下来是。此命令写入“find_package”文件使用的文件，其中包含所需包的版本和兼容性。在这里，我们使用 Tutorial_VERSION_* 变量并说它与 兼容 AnyNewerVersion，这表示该版本或任何更高版本与请求的版本兼容。

```shell
write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/MathFunctionsConfigVersion.cmake"
  VERSION "${Tutorial_VERSION_MAJOR}.${Tutorial_VERSION_MINOR}"
  COMPATIBILITY AnyNewerVersion
)
```

最后，设置要安装的两个生成的文件：

```shell
install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/MathFunctionsConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/MathFunctionsConfigVersion.cmake
  DESTINATION lib/cmake/MathFunctions
  )
```

至此，我们已经为我们的项目生成了一个可重定位的 CMake 配置，可以在项目安装或打包后使用。如果我们希望我们的项目也可以从构建目录中使用，我们只需将以下内容添加到顶层的底部 CMakeLists.txt：

```shell
export(EXPORT MathFunctionsTargets
  FILE "${CMAKE_CURRENT_BINARY_DIR}/MathFunctionsTargets.cmake"
)
```

通过这个导出调用，我们现在生成一个 Targets.cmake，允许 MathFunctionsConfig.cmake 其他项目使用构建目录中的配置，而无需安装它。

## step 12 打包调试和发布

**注意：**此示例对单配置生成器有效，不适用于多配置生成器（例如 Visual Studio）。

默认情况下，CMake 的模型是构建目录只包含一个配置，无论是 Debug、Release、MinSizeRel 还是 RelWithDebInfo。但是，可以将 CPack 设置为捆绑多个构建目录并构建一个包含同一项目的多个配置的包。

首先，我们要确保调试和发布版本对将要安装的可执行文件和库使用不同的名称。让我们使用d作为调试可执行文件和库的后缀。

放 CMAKE_DEBUG_POSTFIX 在顶级 CMakeLists.txt 文件的开头附近：

```shell
set(CMAKE_DEBUG_POSTFIX d)

add_library(tutorial_compiler_flags INTERFACE)
```

和 DEBUG_POSTFIX 教程可执行文件的属性：

```shell
add_executable(Tutorial tutorial.cxx)
set_target_properties(Tutorial PROPERTIES DEBUG_POSTFIX ${CMAKE_DEBUG_POSTFIX})

target_link_libraries(Tutorial PUBLIC MathFunctions)
```

让我们还将版本编号添加到 MathFunctions 库中。在 MathFunctions/CMakeLists.txt 中，设置 VERSION 和 SOVERSION 特性：

```shell
set_property(TARGET MathFunctions PROPERTY VERSION "1.0.0")
set_property(TARGET MathFunctions PROPERTY SOVERSION "1")
```

从 Step12 目录中，创建 debug 和 release 子目录。布局将如下所示：

```shell
- Step12
   - debug
   - release
```

现在我们需要设置调试和发布版本。我们可以用  CMAKE_BUILD_TYPE 设置配置类型：

```shell
cd debug
cmake -DCMAKE_BUILD_TYPE=Debug ..
cmake --build .
cd ../release
cmake -DCMAKE_BUILD_TYPE=Release ..
cmake --build .
```

现在调试和发布版本都已完成，我们可以使用自定义配置文件将两个版本打包到一个版本中。在  Step12 目录中，创建一个名为 MultiCPackConfig.cmake. 在此文件中，首先包含由  cmake 可执行。

接下来，使用 CPACK_INSTALL_CMAKE_PROJECTS 变量指定要安装的项目。在这种情况下，我们要同时安装调试和发布。

```shell
include("release/CPackConfig.cmake")

set(CPACK_INSTALL_CMAKE_PROJECTS
    "debug;Tutorial;ALL;/"
    "release;Tutorial;ALL;/"
    )
```

从 Step12 目录中，运行 cpack 使用以下选项指定我们的自定义配置文件 config：

```shell
cpack --config MultiCPackConfig.cmake
```
