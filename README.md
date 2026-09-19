# K-TS Framework

基于 **Cocos Creator 3.8 / 4.0**(TS 原生引擎,无 C# 侧)的 TypeScript 游戏开发框架。运行时包为 ESM(`"type": "module"`),两个大版本均从 node_modules 原生加载,无需打包绕行。以 yarn workspaces monorepo 形式组织,包含游戏客户端运行时框架、数据导出管线、热更新补丁体系与配套工具链。

本仓库是**通用框架**,不包含任何具体游戏业务逻辑。游戏项目以本框架为依赖,在自己的仓库/Cocos 工程中编写业务代码与数据表。

## 运行环境

| 环境          | 说明                                                                  |
| ------------- | --------------------------------------------------------------------- |
| Node.js       | >= 20(开发/工具链)                                                    |
| Yarn          | v1(classic,workspaces)                                                |
| Cocos Creator | 3.8 / 4.0 运行时宿主(消费项目提供,本仓库仅做类型自检)               |
| 目标平台      | Cocos 原生(iOS/Android/Windows/ macOS)/ 编辑器预览 / Web / 微信小游戏 |

## 目录结构

```
packages/                    框架核心包
├── k-ts-framework/          运行时核心:系统/管理器/存储/事件/装饰器/订阅钩子(引擎无关)
├── k-ts-framework-cocos/    Cocos 绑定:cc 收口/资源加载/PrefabProxy/事件包装/ByteArray/异步加载
├── k-ui-framework/          UI 框架:UISystem/绑定器/状态管理(引擎无关)
├── k-ui-framework-cocos/    Cocos UI 实现:8 个 UIEngineInterface linker/控件搜索/PrefabProxyEx
├── k-ts-protobuf/           网络协议:protobuf 装饰器注册与收发系统
├── game-data-collection/    数据运行时:JSON / INI 数据表加载与查询
├── k-export-flow/           数据导出管线引擎:Excel→CSV→Schema→TS/Lua/JSON,支持增量与 worker 并行
├── patcher/                 热更新补丁核心:manifest/下载整理/应用流程(引擎无关)
├── patcher-cocos/           Cocos 补丁实现:jsb IFS/纯 JS IPath/IEngine 全量实现/最小更新 UI
├── patch-common/            补丁体系共享类型(manifest/版本/语言通道)
└── (旧 Unity 绑定包已从 git 历史移除,可从 b31cb16 找回)
scripts/                     工具链(每个子目录是独立 workspace)
├── export-proto-to-kts/     .proto → TS/Lua 协议代码导出(必传路径参数)
├── convert-excel-to-csv/    Excel → CSV 转换(支持增量)
├── localization-tool/       本地化翻译/拆分/资源替换工具
├── patcher-builder/         补丁包构建(CLI)
├── sentry-error-tracer/     Sentry 错误堆栈还原(内部工具,需环境变量配置)
├── sentry-log-decrypt-cli/  Sentry 加密日志下载/解密 CLI
└── verify-lua-json-consistency.js  校验 Lua 文件列表与 JSON 一致性(独立小工具)
```

## 快速开始

```bash
# 安装依赖(必须从仓库根目录执行,workspaces 统一提升依赖)
yarn

# 代码检查 / 格式化(oxlint + oxfmt)
yarn lint
yarn format

# 清理所有包的构建产物
yarn clean

# 运行各包测试(node 内置 test runner,经 tsx)
yarn --cwd packages/k-export-flow test           # 82 个测试
yarn --cwd packages/k-ts-framework-cocos test    # ByteArray/PrefabProxy/readTextFile
yarn --cwd packages/k-ui-framework-cocos test    # sortingOrder → siblingIndex 重排
yarn --cwd packages/patcher-cocos test           # IPath 纯 JS 实现
yarn --cwd packages/patcher test                 # 补丁整理 IO 语义(需消费项目注入 LanguageDefine)
```

## 框架包依赖方向

```
k-ts-framework(核心)
  ├─ k-ts-framework-cocos ── k-ui-framework-cocos / patcher-cocos
  ├─ k-ui-framework
  ├─ k-ts-protobuf
  ├─ game-data-collection
  └─ patcher ── patch-common

k-export-flow:独立,不依赖运行时核心
```

消费项目(具体游戏)位于框架之上,通过 workspace 或包引用依赖各 `k-*` 包。

## Cocos 接入

消费项目的 Cocos Creator 工程(3.8 / 4.0,框架包经 node_modules 原生加载):

1. **场景挂两个组件**:在场景任一节点挂 `KFrameworkBootstrap`(k-ts-framework-cocos)与 `CocosUISystem`(k-ui-framework-cocos),onLoad 时自动完成 `registerKFrameworkCocos()` / `registerCocosUI()` 装配(订阅器、linker、UI 系统创建)。**3.8 注意**:node_modules 模块没有编辑器组件注册帧,装饰器会自动降级为透传(控制台有警告),此时改为在任一入口脚本直接调用这两个 `register*` 函数(幂等,效果相同)。
2. **面板放置**:UI 面板 prefab 放 `resources/ui/<uiTag>.prefab`(常量 `UI_PANEL_PREFIX` 单点可改);wnd 模板经 `registerCocosUITemplate(tag, { wnd: { wndLayer } })` 注册,未注册默认 wndLayer 1。
3. **面板操作入口**:`getPrefabProxy<T>(store)` / `findPrefabProxy<T>(store)` 获取面板代理(`PrefabProxyEx`,含 Label/Sprite/Button/Toggle/Slider/EditBox/ScrollView 常用方法)。
4. **从 Unity 迁移注意**:`getUITemplate` linker 已由 k-ui-framework-cocos 默认实现(注册表 + 默认约定),消费项目**不要**再自行 `linkUtil(getUITemplate)`(linker 单链接,重复注册会在模块加载时断言失败);改用 `registerCocosUITemplate` 逐 tag 注册。
5. **热更新启动**:

```ts
import { startPatcher } from "patcher";
import { registerPatcherCocos } from "patcher-cocos";

let engine = registerPatcherCocos({
    entryUrl: "https://patch.example.com",
    localResVersion: 74883,
    onUnzipFile: async (zip, savePath) => myUnzip(zip, savePath), // 解压外抛给消费项目
});
await startPatcher(engine, builtinLanguages, defaultLanguage);
```

`IFS` 在非 jsb 运行时(编辑器预览/web)统一外抛,消费项目用 `registerPatcherCocos({ ... })` 按回调覆盖。
数据表 JSON 经 `F.Engine.readTextFile` 同步读取:原生走 `jsb.fileUtils`,编辑器/web 走 resources 已缓存的 TextAsset。注意该 linker 由 k-ts-framework-cocos 单点链接、不可再覆盖;JSON 级自定义读取走 game-data-collection 的 `setJsonLoadFunc`。

## 使用本框架的游戏项目需要提供

以下内容由消费项目生成或注入,本仓库刻意不包含:

1. **`cc` 引擎类型** — Cocos 3.8 / 4.0 工程自带真实 cc 类型。框架自带的 `typing/cocos/cc.d.ts` 仅供仓库内 tsconfig 类型自检(最小 API 子集),消费项目**不要** include;若出现重复声明,把该文件从 `typeRoots` 链路移出、改由自检 tsconfig 显式引入。
2. **`packages/patcher/src/LanguageDefine.ts` 与 `packages/patch-common/src/LanguageDefine.ts`** — 多语言枚举(`EGameLanguage` 等),由消费项目的 export-flow 管线生成(参考 `scripts/patcher-builder/src/LanguageChannelConfig.ts` 中的读取与校验);`patcher` 与 `patch-common` 编译前必须存在,语言列表变更后需重新生成。
3. **`ExternalConfig/export-flow-setting/`** — `k-export-flow` 管线配置(`pipeline.yml`、`post-process-deps.yml` 等),路径相对于消费项目根目录。
4. **数据表与协议源文件** — Excel 设计表、`.proto` 文件,经工具链生成 TS/Lua/JSON。

## 工具链速查

| 命令                                                                                                       | 作用                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn export-proto -- --protoRootPath <dir> --sourcePath <dir> --targetTsPath <dir> --targetLuaPath <dir>` | 导出协议代码(增量:`--increment`)。可选:`--bundleJsPath`/`--bundleDtsPath`/`--distBundleJsPath`/`--monoProtoPath`/`--protocolRegisterModule`/`--incrementCachePath` |
| `yarn localization-tool`                                                                                   | 本地化工具;`translate`/`replace-res`/`gen-config` 子命令需 `--project-root <消费项目根目录>`(默认当前目录)                                                         |
| `yarn sentry-log`                                                                                          | Sentry 日志解密 CLI                                                                                                                                                |
| `yarn sentry-error-tracer`                                                                                 | Sentry 错误追踪(需 `SENTRY_AUTH_TOKEN`;可选 `TS_PROJECT_ROOT`、`JENKINS_SOURCEMAP_BASE_URL`)                                                                       |
| `node scripts/verify-lua-json-consistency.js <lua-file> <json-file> [--max-mismatches=N]`                  | 校验 Lua 与 JSON 一致性                                                                                                                                            |

> `export-proto-to-kts` 通过 `--protocolRegisterModule <模块名>` 在生成的 index.ts 中输出协议注册代码(模块需导出 `registerC2SProtocol`/`registerS2CProtocol`);不传则只生成纯类型导出。工具不内置任何项目路径。

## 已知待办

- `k-export-flow/src/new/misc/ExportRunStats.ts` 中输出分类前缀仍按旧项目布局硬编码(`TypeScripts/packages/client/...`),接入新项目时需参数化(对应测试在 `tests/generate-schema-and-summary.test.ts`)。
- 存量代码存在 oxlint 历史告警(`eqeqeq`、`no-require-imports` 等),见 AGENTS.md。

## 许可

内部框架,未公开许可。
