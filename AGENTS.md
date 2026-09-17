# AGENTS.md

AI 助手与贡献者的工作说明。先读 README.md 了解框架全貌。

## 仓库性质

- **通用游戏开发框架**(Unity + Puerts / TypeScript),不含具体游戏逻辑。数据表导出器(`single-table/DT*`)、游戏客户端入口、游戏构建管线属于消费项目,不应出现在本仓库。
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
yarn --cwd packages/k-export-flow test
yarn --cwd packages/patcher test    # 依赖注入的 LanguageDefine.ts,纯框架检出中失败属预期
```

注意:`tsc` 全量类型检查依赖消费项目注入的 ambient 类型(见下),在纯框架检出中 `patcher` 的 `typecheck` 会因缺 `puerts` 类型而失败,这是预期行为,不是回归。

## 技术栈与硬性约定

- TypeScript strict + `experimentalDecorators` + `emitDecoratorMetadata`(装饰器是框架核心机制,勿改 tsconfig.base.json 的这两项)。
- Linter/formatter 是 **oxc**(oxlint/oxfmt),配置在根 `.oxlintrc.json` / `.oxfmtrc.json`。不要引入 ESLint/Prettier。
- 格式化:`oxfmt --disable-nested-config`;import 双引号、保存时排序去重(见 `.vscode/settings.json`)。
- 运行时全局变量 `CS` / `puer` 由 Puerts 注入,已在 oxlint globals 声明;新增 Puerts 全局需同步 `.oxlintrc.json`。
- 目标运行时也包含微信小游戏:不要直接依赖 node 内置模块;需要时用 `libs-generator` 打包的 shim。
- 新代码一律 ESM `import`;存量代码有 `require` 调用(oxlint `no-require-imports` 存量错误),改动到这些文件时顺手改为 import。

## 架构要点

- **依赖方向**:`k-ts-framework` 是核心,其余 `k-*` 包依赖它;`*-unity` 包是 Unity 侧实现;`k-export-flow` 与 `libs-generator` 独立。不要反向依赖。
- `tsconfig.ts7.json` = 包级构建图节点( extends 包 tsconfig + project references ),构建信息文件 `*.ts7.tsbuildinfo`。
- `k-export-flow` 独立演进(自带版本号),通过 `P.*` 命名空间导出管线 API;消费项目用 pipeline.yml 驱动。
- 补丁体系:`patch-common`(类型)← `patcher`(运行时)← `scripts/patcher-builder`(构建工具),语言通道依赖 `LanguageDefine.ts`。

## 消费项目注入点(框架代码中刻意留空)

| 注入点 | 提供者 | 说明 |
|---|---|---|
| `typing/*.d.ts` | Puerts / 消费项目 | `puerts`、`csharp`、`global`、`prefab` ambient 类型 |
| `packages/patcher/src/LanguageDefine.ts` | 消费项目 export-flow 生成 | 多语言枚举,顶层引用 Unity `CS` 故 Node 下只能解析源文件(见 `scripts/patcher-builder/src/LanguageChannelConfig.ts`);缺失时 patcher 测试无法运行(预期) |
| `packages/patch-common/src/LanguageDefine.ts` | 消费项目 export-flow 生成 | 同上,patch-common 也直接依赖;语言列表变更后需重新生成 |
| `ExternalConfig/export-flow-setting/` | 消费项目 | k-export-flow 的 pipeline.yml / post-process-deps.yml |
| 各包 `dist/` | 构建生成 | 已 gitignore |

## 已知技术债(改动相关代码时顺手清理,不要专门开 PR 刷)

- oxlint 存量错误 60 个(2026-09 基线):集中在 `k-export-flow/src/new/misc/Loader.ts`、`Manager.ts`、`scripts/convert-excel-to-csv/src/index.ts`、`libs-generator/src/_node-shims/*.js`(多为 `eqeqeq`、`no-require-imports`、`max-depth`)。修复时保持行为不变。
- `ExportRunStats.ts` 输出分类前缀仍为旧项目布局硬编码,参数化时需同步更新 `tests/generate-schema-and-summary.test.ts`。
- `scripts/localization-tool` 的目录布局约定(`ExternalConfig/...`、`TempSaved/...`)集中在 `src/Define.ts#resolvePaths`,接入非标布局的项目时改这一处。
- 工具配置一律走参数/环境变量,不要把项目路径或密钥写回代码(参见 `sentry-error-tracer` 的 `SENTRY_AUTH_TOKEN` 环境变量改造)。

## 不要做的事

- 不要提交 `dist/`、`*.tsbuildinfo`、`node_modules/`、嵌套 `yarn.lock`。
- 不要在框架包内新增游戏业务代码(数据表、玩法系统、UI 界面);这些内容属于消费项目。
- 不要改包名/`k-*` 前缀;不要合并或拆分 workspace,除非同步更新根 `package.json` workspaces 与 README。
- 不要把个人本地绝对路径写进任何配置(调试 launch.json 曾因个人路径污染被清理)。
