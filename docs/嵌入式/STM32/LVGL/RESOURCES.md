# LVGL 课程资源

## Knowledge

- [《LVGL 开发指南 V1.5》— 正点原子（本地 PDF）](参考文档/LVGL开发指南_V1.5.pdf)
  课程主线教材，V1.5 对应 LVGL v8.2，与工程中的 v8.3.11 兼容。共四篇 49 章：基础篇（移植/对象/样式/动画/事件/文件系统/字库）、部件篇（33 个部件）、组件篇（图片解码库/SquareLine）、布局篇（Flex/Grid）。**用**：每课的主讲来源，先看 PDF 对应章节再上课。

- [LVGL 官方文档（v8.3）](https://docs.lvgl.io/8.3/)
  最权威的一手资料，英文。部件 API、样式属性全表、示例代码都在这里。**用**：PDF 讲不清或 API 记不准时去查；每课的"官方原文"推荐阅读。

- [LVGL GitHub 仓库](https://github.com/lvgl/lvgl)
  源码、`examples/` 官方例程、`lv_conf_template.h` 配置模板。工程里的 `EXTERNAL/LVGL` 即 v8.3.11 源码。**用**：查源码实现、参考官方 widgets 例程。

- [lvgl.io 官方工具页](https://lvgl.io/tools)
  图片转换器（PNG→C 数组）与字体转换器（TTF→C 数组）在线版。**用**：第 11 课（图片与字库）生成 C 字库/图片数组；离线版在正点原子光盘"LVGL 使用工具.zip"。

- [SquareLine Studio](https://squareline.io/)
  官方可视化 UI 设计器，拖拽生成代码，免费版功能够用。**用**：课程全部学完后，做产品界面原型提速。

## Wisdom (Communities)

- [开源电子网 / 正点原子论坛](https://www.openedv.com/forum.php)
  正点原子官方论坛，移植报错、硬件问题的高频答案聚集地。**用**：工程相关疑难杂症（驱动、FSMC、触摸校准）。

- [LVGL 官方论坛](https://forum.lvgl.io/)
  全球开发者社区，官方团队在线答疑。**用**：LVGL 本身的行为疑问、bug 确认、性能问题。

- 本地：无（暂不加入线下社区）

## Gaps

- 中文的 LVGL v8.3 系统级资料（内存管理、渲染机制深入剖析）稀缺，PDF 只覆盖到 v8.2 的应用层。需要时以官方文档和源码为准。