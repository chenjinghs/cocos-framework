# K-TS Framework

基于 **Unity + Puerts** 的 TypeScript 游戏开发框架。以 yarn workspaces monorepo 形式组织,包含游戏客户端运行时框架、数据导出管线、热更新补丁体系与配套工具链。

本仓库是**通用框架**,不包含任何具体游戏业务逻辑。游戏项目以本框架为依赖,在自己的仓库中编写业务代码与数据表。

## 运行环境

| 环境 | 说明 |
|---|---|
| Node.js | >= 20(开发/工具链) |
| Yarn | v1(classic,workspaces) |
| Unity + Puerts | 运行时宿主(PuerTS 执行 TypeScript) |
| 目标平台 | Unity 编辑器 / iOS / Android / Windows / 微信小游戏 |

## 目录结构

```
packages/                    框架核心包
├── k-ts-framework/          运行时核心:系统/管理器/存储/事件/装饰器/订阅钩子
├── k-ts-framework-unity/    Unity 绑定:GameObject/Prefab/UnityEvent 封装
├── k-ui-framework/          UI 框架:UISystem/绑定器/状态管理
├── k-ui-framework-unity/    Unity UI 实现:UnityUISystem/控件搜索
├── k-ts-protobuf/           网络协议:protobuf 装饰器注册与收发系统
├── k-ts-command-unity/      命令系统:C2D 命令路由与分发
├── game-data-collection/    数据运行时:JSON / INI 数据表加载与查询
├── k-export-flow/           数据导出管线引擎:Excel→CSV→Schema→TS/Lua/JSON,支持增量与 worker 并行
├── patcher/                 热更新下载/补丁应用(含更新 UI)
├── patch-common/            补丁体系共享类型(manifest/版本/语言通道)
└── libs-generator/          node 内置模块(fs/path/url/source-map)的小游戏兼容打包
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
yarn --cwd packages/k-export-flow test      # 82 个测试
yarn --cwd packages/patcher test
```

## 框架包依赖方向

```
k-ts-framework(核心)
  ├─ k-ts-framework-unity ── k-ts-command-unity
  ├─ k-ui-framework ──────── k-ui-framework-unity
  ├─ k-ts-protobuf
  ├─ game-data-collection
  └─ patcher ── patch-common

k-export-flow / libs-generator:独立,不依赖运行时核心
```

消费项目(具体游戏)位于框架之上,通过 workspace 或包引用依赖各 `k-*` 包。

## 使用本框架的游戏项目需要提供

以下内容由消费项目生成或注入,本仓库刻意不包含:

1. **`typing/` 环境声明** — `tsconfig.base.json` 的 `typeRoots` 指向 `./typing`,包含 `puerts` / `csharp` / `global` / `prefab` 等 ambient 类型(PuerTS 生成)。
2. **`packages/patcher/src/LanguageDefine.ts` 与 `packages/patch-common/src/LanguageDefine.ts`** — 多语言枚举(`EGameLanguage` 等),由消费项目的 export-flow 管线生成(参考 `scripts/patcher-builder/src/LanguageChannelConfig.ts` 中的读取与校验注释:该文件顶层引用 Unity 运行时全局 `CS`,无法在 Node 下 import,只能解析源文件);`patcher` 与 `patch-common` 编译前必须存在,语言列表变更后需重新生成。
3. **`ExternalConfig/export-flow-setting/`** — `k-export-flow` 管线配置(`pipeline.yml`、`post-process-deps.yml` 等),路径相对于消费项目根目录。
4. **数据表与协议源文件** — Excel 设计表、`.proto` 文件,经工具链生成 TS/Lua/JSON。

## 工具链速查

| 命令 | 作用 |
|---|---|
| `yarn export-proto -- --protoRootPath <dir> --sourcePath <dir> --targetTsPath <dir> --targetLuaPath <dir>` | 导出协议代码(增量:`--increment`)。可选:`--bundleJsPath`/`--bundleDtsPath`/`--distBundleJsPath`/`--monoProtoPath`/`--protocolRegisterModule`/`--incrementCachePath` |
| `yarn localization-tool` | 本地化工具;`translate`/`replace-res`/`gen-config` 子命令需 `--project-root <消费项目根目录>`(默认当前目录) |
| `yarn sentry-log` | Sentry 日志解密 CLI |
| `yarn sentry-error-tracer` | Sentry 错误追踪(需 `SENTRY_AUTH_TOKEN`;可选 `TS_PROJECT_ROOT`、`JENKINS_SOURCEMAP_BASE_URL`) |
| `node scripts/verify-lua-json-consistency.js <lua-file> <json-file> [--max-mismatches=N]` | 校验 Lua 与 JSON 一致性 |

> `export-proto-to-kts` 通过 `--protocolRegisterModule <模块名>` 在生成的 index.ts 中输出协议注册代码(模块需导出 `registerC2SProtocol`/`registerS2CProtocol`);不传则只生成纯类型导出。工具不内置任何项目路径。

## 已知待办

- `k-export-flow/src/new/misc/ExportRunStats.ts` 中输出分类前缀仍按旧项目布局硬编码(`TypeScripts/packages/client/...`),接入新项目时需参数化(对应测试在 `tests/generate-schema-and-summary.test.ts`)。
- 存量代码存在 oxlint 历史告警(`eqeqeq`、`no-require-imports` 等),见 AGENTS.md。

## 许可

内部框架,未公开许可。
