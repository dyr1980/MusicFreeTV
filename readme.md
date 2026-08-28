# MusicFreeTV

面向 Android TV、电视盒子和遥控器重新设计的插件化音乐播放器。

MusicFreeTV 是 [maotoumao/MusicFree](https://github.com/maotoumao/MusicFree) 的独立派生项目，保留了原 Android 版的插件、搜索、推荐歌单、榜单、收藏、本地音乐、歌词、下载、历史记录、备份和播放控制能力，并为 10-foot UI 与 D-pad 操作重做了界面。本项目不是原作者发布的官方 TV 版本。

## TV 特性

- 全局 D-pad 焦点：方向键移动、确认键执行、返回键回退；焦点始终有可见描边和缩放反馈。
- TV 首页：固定功能侧栏、正在播放卡片和四列歌单区域，适配 16:9 横屏。
- 遥控媒体键：播放/暂停、上一首、下一首和菜单键可直接控制播放队列。
- 完整播放器：插件搜索与播放、推荐歌单、榜单、歌手/专辑详情、同步歌词、收藏和历史。
- 本地能力：扫描本地音乐、歌单管理、下载管理、配置备份与恢复。
- 无内置音源、无广告、无需登录；用户数据默认保存在设备本地。

## 遥控器操作

| 按键 | 行为 |
| --- | --- |
| 方向键 | 在可操作元素间移动焦点 |
| 确认键 | 打开页面或执行当前操作 |
| 返回键 | 返回上一页；首页再次返回可退出 |
| 播放/暂停 | 切换当前歌曲状态 |
| 上一首 / 下一首 | 切换播放队列 |
| 菜单键 | 打开当前播放列表 |

## 本地开发

环境要求：Node.js 18+、JDK 17、Android SDK（API 35）以及 Android NDK。项目只提供 Android TV 目标。

```powershell
npm install
npm run start
npm run android
```

Release 构建需要在 `android/keystore.properties` 配置自己的签名：

```properties
RELEASE_STORE_FILE=tv-release.keystore
RELEASE_STORE_PASSWORD=your-password
RELEASE_KEY_ALIAS=musicfreetv
RELEASE_KEY_PASSWORD=your-password
```

然后运行 `npm run build-tv`。

## 插件

插件协议和核心数据结构与原 MusicFree Android 版兼容。插件是可执行的 CommonJS 模块，可实现搜索、播放地址、歌词、歌手、专辑、推荐歌单、榜单和歌单导入等接口。请参考原作者的[插件开发文档](https://musicfree.catcat.work/plugin/introduction.html)。

应用本身不提供、破解或绕过任何付费音源。第三方插件可能联网并执行代码，只应安装你信任且有权使用的插件；插件及其产生的数据由插件提供者和使用者负责。

## 开源协议与原作者要求

本项目沿用 [GNU Affero General Public License v3.0](./LICENSE)。使用、修改、分发或通过网络提供修改版时，请履行 AGPL-3.0 的源代码提供义务，并保留原作者猫头猫（maotoumao）、[原项目地址](https://github.com/maotoumao/MusicFree)、原许可证及本项目的 [`NOTICE`](./NOTICE)。

同时遵循原作者项目 README 中的附加说明：保持免费、合法合规使用、不用于商业用途，不以“VIP/破解”为噱头宣传。修改版所产生的问题由修改版维护者承担。

## 隐私与内容边界

MusicFreeTV 不提供账号系统，不运营用户生成内容社区，也不收集用户个人信息。应用设置、歌单和历史记录默认存储在本地。若安装第三方插件，其网络请求、认证和数据处理不属于 MusicFreeTV；安装前请自行审查源码与权限。
