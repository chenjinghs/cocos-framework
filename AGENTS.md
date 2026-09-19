# AGENTS.md

AI 助手与贡献者的工作说明。先读 README.md 了解框架全貌。

## 仓库性质

- **通用游戏开发框架**(Cocos Creator 3.8 / 4.0 / TypeScript,TS 原生引擎,无 C# 侧),不含具体游戏逻辑。数据表导出器(`single-table/DT*`)、游戏客户端入口、游戏构建管线属于消费项目,不应出现在本仓库。
- **yarn v1 workspaces monorepo**:`packages/*` 与 `scripts/*` 都是 workspace。
- 依赖永远从**仓库根目录**安装;**不要重建子目录的 yarn.lock**(已统一清理,安装一律以根 `yarn.lock` 为准)。

## 常用命令

```bash
yarn                  # 根目录安装全部依赖(唯一正确的安装方式)
yarn lint             # oxlint 全仓检查
yarn lint:fix         # 自动修复
yarn format           # oxfmt 格式化
yarn format:check     # 格式检查
yarn clean            # 删除各包 dist 与 *.tsbuildinfo

# 测试(node:test + tsx,无单独框架)
yarn --cwd packages/k-export-flow test           # 82 个测试
yarn --cwd packages/k-ts-framework-cocos test    # ByteArray/PrefabProxy/readTextFile
yarn --cwd packages/k-ui-framework-cocos test    # sortingOrder → siblingIndex
yarn --cwd packages/patcher-cocos test           # IPath 纯 JS 实现
yarn --cwd packages/patcher test                 # 补丁整理 IO 语义

# 类型自检(各包 tsconfig.json 为 paths→源码的自检配置,无需先构建 dist)
yarn tsc --noEmit -p packages/k-ts-framework/tsconfig.json
# patcher / patch-common 例外:依赖消费项目注入的 LanguageDefine.ts,纯框架检出中 typecheck 失败属预期
```

注意:`tsc` 全量类型检查中 `patcher` 与 `patch-common` 会因缺 `LanguageDefine.ts`(消费项目注入)失败,这是预期行为,不是回归。

## 技术栈与硬性约定

- TypeScript strict + `experimentalDecorators` + `emitDecoratorMetadata`(装饰器是框架核心机制,勿改 tsconfig.base.json 的这两项)。
- Linter/formatter 是 **oxc**(oxlint/oxfmt),配置在根 `.oxlintrc.json` / `.oxfmtrc.json`。不要引入 ESLint/Prettier。
- 格式化:`oxfmt --disable-nested-config`;import 双引号、保存时排序去重(见 `.vscode/settings.json`)。
- 运行时全局 `jsb`(Cocos 原生)已在 oxlint globals 声明;新增引擎全局需同步 `.oxlintrc.json`。
- 目标运行时包含微信小游戏:不要直接依赖 node 内置模块。
- 新代码一律 ESM `import`;存量代码有 `require` 调用(oxlint `no-require-imports` 存量错误),改动到这些文件时顺手改为 import。
- 运行时 4 包(`k-ts-framework`/-cocos、`k-ui-framework`/-cocos)是 `"type": "module"` 的 ESM 包:src 相对导入/再导出必须带显式 `.js` 后缀,纯类型的具名再导出必须 `export type`(node16 ESM 类型检查与 Creator 3.8/4.0 的 node_modules ESM 解析双重要求);`declare module` 增强说明符同理。

## 架构要点

- **依赖方向**:`k-ts-framework` 是核心,其余 `k-*` 包依赖它;`*-cocos` 包是 Cocos 侧实现(`k-ts-framework-cocos` ← `k-ui-framework-cocos` / `patcher-cocos`);`k-export-flow` 独立。不要反向依赖。
- `tsconfig.ts7.json` = 包级构建图节点( extends 包 tsconfig + project references ),构建信息文件 `*.ts7.tsbuildinfo`。包级 `tsconfig.json` 是 paths→源码的类型自检配置(composite 关闭),真实构建以 tsconfig.ts7.json 为准。
- `k-export-flow` 独立演进(自带版本号),通过 `P.*` 命名空间导出管线 API;消费项目用 pipeline.yml 驱动。
- 补丁体系:`patch-common`(类型)← `patcher`(引擎无关核心)← `patcher-cocos`(Cocos 实现);语言通道依赖 `LanguageDefine.ts`。
- 引擎触点一律经 linker/subscriber 注入(`F.createUtilLinker` + `D.linkUtil`、`F.HookUtil.get(F.SubscribeHook)`),核心包保持引擎无关。

## 消费项目注入点(框架代码中刻意留空)

| 注入点                                        | 提供者                    | 说明                                                                                                                                                         |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cc` 引擎类型                                 | Cocos 3.8 / 4.0 工程自带  | 框架自带 `typing/cocos/cc.d.ts` 最小声明仅供仓库自检(`typeRoots` 链路),消费项目不要 include;若重复声明,把它移出 typeRoots、改由自检 tsconfig 显式 files 引入 |
| `packages/patcher/src/LanguageDefine.ts`      | 消费项目 export-flow 生成 | 多语言枚举,patcher 直接依赖;缺失时 patcher 测试与 typecheck 无法运行(预期)                                                                                   |
| `packages/patch-common/src/LanguageDefine.ts` | 消费项目 export-flow 生成 | 同上,patch-common 也直接依赖;语言列表变更后需重新生成                                                                                                        |
| `ExternalConfig/export-flow-setting/`         | 消费项目                  | k-export-flow 的 pipeline.yml / post-process-deps.yml                                                                                                        |
| 各包 `dist/`                                  | 构建生成                  | 已 gitignore                                                                                                                                                 |
| `patcher` 的 IFS/IPath/UI/解压                | patcher-cocos 注入        | `registerPatcherCocos()` 装配默认 Cocos 实现,消费项目按回调覆盖(如 `onUnzipFile`)                                                                            |

## 已知技术债(改动相关代码时顺手清理,不要专门开 PR 刷)

- oxlint 存量错误 50 个(2026-09 基线):集中在 `scripts/convert-excel-to-csv/src/index.ts`、`scripts/patcher-builder/src/index.ts`、`k-export-flow/src/new/`(`Loader.ts`、`Manager.ts` 等)、`k-ts-protobuf/src/Util.ts`(多为 `eqeqeq`、`no-require-imports`、`complexity`、`max-depth`)。修复时保持行为不变。
- `ExportRunStats.ts` 输出分类前缀仍为旧项目布局硬编码,参数化时需同步更新 `tests/generate-schema-and-summary.test.ts`。
- `scripts/localization-tool` 的目录布局约定(`ExternalConfig/...`、`TempSaved/...`)集中在 `src/Define.ts#resolvePaths`,接入非标布局的项目时改这一处。
- 工具配置一律走参数/环境变量,不要把项目路径或密钥写回代码(参见 `sentry-error-tracer` 的 `SENTRY_AUTH_TOKEN` 环境变量改造)。
- 跨包 System 类型化 subscribe 重载增强(`declare module "k-ts-framework/dist/framework/System.js"`,见 k-ui-framework/SubscriberExtension.ts 与 k-ts-framework-cocos 的 AsyncLoad/DelegateEvent):ESM 化后说明符必须带 `.js` 后缀(3.8/4.0 的 node_modules ESM 解析与 node16 类型检查要求),各包 tsconfig paths 已同步映射 `.js` 键。src 自检、tsc -b project-references 构建、node_modules dist 消费三条链路均能正常合并;`k-ui-framework-cocos/CocosUISystem.ts` 的显式透传是历史绕过,保留无害。

## 不要做的事

- 不要提交 `dist/`、`*.tsbuildinfo`、`node_modules/`、嵌套 `yarn.lock`。
- 不要在框架包内新增游戏业务代码(数据表、玩法系统、UI 界面);这些内容属于消费项目。
- 不要改包名/`k-*` 前缀;不要合并或拆分 workspace,除非同步更新根 `package.json` workspaces 与 README。
- 不要把个人本地绝对路径写进任何配置(调试 launch.json 曾因个人路径污染被清理)。
- 不要再引入 Unity/PuerTS 相关代码;Unity 版本可从 git 历史 `b31cb16` 找回。
