# 环境安装与 Test 项目创建流程（Cocos Creator 3.8 / 4.0）

> 本仓库已迁移到 **Cocos Creator 4.0**（TS 原生引擎，无 C# 侧）。旧的 Unity + Puerts 版本已从主分支移除，需要时可从 git 历史 `b31cb16` 找回。
>
> 框架运行时包（k-ts-framework/-cocos、k-ui-framework/-cocos）同时兼容 **3.8 与 4.0**：dist 为 ESM（`"type": "module"`、相对导入带 `.js` 后缀），两个大版本均支持脚本从 node_modules 原生导入。3.8 下组件注册失败时框架装饰器自动降级为透传，装配改走代码调用（见 6.4）。
>
> 本文讲完整流程：安装基础环境 → 安装 Cocos Creator → 检出本框架 → 创建一个最小的 Test 消费项目并跑通。

## 1. 环境要求总览

| 工具          | 版本要求             | 用途                                    |
| ------------- | -------------------- | --------------------------------------- |
| Git           | 任意较新版本         | 检出仓库                                |
| Node.js       | >= 20（建议 LTS）    | 工具链 / 构建 / 测试                    |
| Yarn          | v1 classic（1.22.x） | 包管理（workspaces monorepo）           |
| Cocos Creator | 3.8（≥ 3.8.x）/ 4.0    | 运行时宿主（消费项目的 Cocos 工程提供） |
| VS Code       | 最新版 + `oxc` 扩展  | 编辑器（保存时自动 lint/format）        |

> 本框架仓库只包含 TypeScript 侧代码，**不含 Cocos 工程**。Cocos Creator 4.0 工程由消费项目（游戏项目）提供，负责场景、prefab 与运行宿主。只做框架/工具链开发时，装 Node + Yarn 即可；要跑 Test 项目才需要装 Creator。

## 2. 安装基础环境

### 2.1 Node.js

1. 到 <https://nodejs.org> 下载并安装 **LTS 版本（>= 20）**；
2. 验证：

```bash
node -v    # 输出 v20.x 或更高
npm -v
```

### 2.2 Yarn v1（classic）

本仓库使用 yarn v1 workspaces，**不要用 yarn 2+ / npm / pnpm 安装依赖**。

```bash
npm install -g yarn
yarn -v    # 必须输出 1.22.x
```

### 2.3 Git

```bash
git --version
```

### 2.4 VS Code 与 oxc 扩展

1. 安装 VS Code；
2. 安装扩展 **oxc**（`oxc.oxc-vscode`），仓库 `.vscode/settings.json` 已配置保存时自动 lint + format；
3. 用 VS Code 打开 `code-zero-ts.code-workspace` 工作区（而不是裸打开文件夹），可获得完整配置。

## 3. 安装 Cocos Creator（3.8 或 4.0）

1. 下载安装 **Cocos Dashboard**：<https://www.cocos.com/creator-download>；
2. 打开 Dashboard，登录 Cocos 账号，进入 **编辑器（Installs）** 页；
3. 安装一个 **Cocos Creator 4.0.x** 或 **3.8.x** 版本（框架运行时包两个大版本均支持，ESM 包从 node_modules 原生加载）；
4. 装完后在 Dashboard 里保持该版本可用，第 6 节新建 Test 工程时会用到。

## 4. 检出框架并安装依赖

```bash
git clone <框架仓库地址> cocos-framework
cd cocos-framework

# 必须从仓库根目录安装（workspaces 统一提升依赖）
yarn
```

**注意**：依赖永远从仓库根目录安装，以根 `yarn.lock` 为准；**不要**在任何子目录里重建 `yarn.lock`。

### 4.1 验证安装

```bash
yarn lint                                      # oxlint 全仓检查
yarn format:check                              # oxfmt 格式检查

# 测试（node 内置 test runner，经 tsx）
yarn --cwd packages/k-export-flow test         # 82 个测试
yarn --cwd packages/k-ts-framework-cocos test  # ByteArray/PrefabProxy/readTextFile
yarn --cwd packages/k-ui-framework-cocos test  # sortingOrder → siblingIndex 重排
yarn --cwd packages/patcher-cocos test         # IPath 纯 JS 实现
```

全部通过即环境正常。

### 4.2 预期中的"失败"（不是环境问题）

`yarn --cwd packages/patcher test`（及 patcher / patch-common 的类型检查）会失败：这两个包直接依赖 `LanguageDefine.ts`（多语言枚举），该文件由**消费项目的 export-flow 管线生成**，纯框架检出中刻意不存在。属预期行为，不是回归。

## 5. 类型自检与构建

仓库里每个包有两套 tsconfig，用途不同（见 AGENTS.md）：

```bash
# 类型自检：各包 tsconfig.json 是 paths→源码的自检配置，无需先构建 dist
yarn tsc --noEmit -p packages/k-ts-framework/tsconfig.json
yarn tsc --noEmit -p packages/k-ts-framework-cocos/tsconfig.json

# 真实构建：tsconfig.ts7.json 是包级构建图节点（project references），
# 产物在各包 dist/（已 gitignore），构建信息写 *.ts7.tsbuildinfo
yarn tsc -b packages/k-ts-framework/tsconfig.ts7.json
yarn tsc -b packages/k-ts-framework-cocos/tsconfig.ts7.json
yarn tsc -b packages/k-ui-framework/tsconfig.ts7.json
yarn tsc -b packages/k-ui-framework-cocos/tsconfig.ts7.json

# 清理全部构建产物
yarn clean
```

同样，patcher / patch-common 的构建与自检会因缺 `LanguageDefine.ts` 失败，属预期。

## 6. 创建 Test 项目

### 6.1 新建 Cocos 工程

1. 打开 Cocos Dashboard → **项目（Projects）** → **新建**；
2. 选择已安装的 **Creator 4.0.x**，模板选 **Empty(空白)**；
3. 项目名称填 `Test`，选择存放路径，点 **创建并打开**。

### 6.2 接入框架包

消费项目通过 workspace 或包引用依赖各 `k-*` 包（README「框架包依赖方向」）。Test 项目最小接入只需两个：

```json
{
    "dependencies": {
        "k-ts-framework": "*",
        "k-ts-framework-cocos": "*"
    }
}
```

- **workspace 方式**：把框架仓库与 Test 工程放进同一个 yarn workspace 根（根 `package.json` 的 `workspaces` 同时包含两边），用 `"k-ts-framework": "*"` 引用——改框架代码即时生效，适合要跟着框架开发的情况；
- **git 依赖方式**：`"k-ts-framework": "git+<内网仓库地址>#<版本>"`，适合只消费不修改。

无论哪种方式：先按第 5 节构建出被引用包的 `dist/`，再 `yarn` 安装链接；然后在 Test 工程的脚本里即可 `import { D, F } from "k-ts-framework"`。框架包是 ESM 包（`"type": "module"`、相对导入带 `.js` 后缀），Cocos Creator 3.8 与 4.0 均支持脚本从 node_modules 导入 npm 包。

若还要接入 UI 框架，加 `k-ui-framework` + `k-ui-framework-cocos`；接入热更新，加 `patcher` + `patcher-cocos` + `patch-common`。

### 6.3 补齐注入点

| 注入点                                                                                  | Test 项目怎么处理                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `cc` 引擎类型                                                                           | **不用管**：Cocos 4.0 工程自带完整 cc 类型。框架自带的 `typing/cocos/cc.d.ts` 仅供仓库内自检，消费项目**不要** include（会出现重复声明） |
| `packages/patcher/src/LanguageDefine.ts`、`packages/patch-common/src/LanguageDefine.ts` | 用到 patcher / patch-common 时才需要，由 export-flow 管线生成；Test 项目暂不接热更新可先跳过                                             |
| `ExternalConfig/export-flow-setting/`                                                   | 用到 `k-export-flow` 导数据表时才需要（`pipeline.yml` 等，路径相对消费项目根目录）                                                       |
| 数据表 / 协议源                                                                         | Excel 设计表与 `.proto` 文件，用框架工具链（`yarn export-proto` 等）生成 TS/JSON                                                         |
| patcher 的 IFS/IPath/UI/解压                                                            | 由 `patcher-cocos` 的 `registerPatcherCocos()` 装配，消费项目按回调覆盖（如 `onUnzipFile`）                                              |

### 6.4 场景挂框架组件

打开 Test 工程主场景，选中任一节点（如 Canvas），添加两个自定义组件：

- **`KFrameworkBootstrap`**（来自 `k-ts-framework-cocos`）— onLoad 时自动执行 `registerKFrameworkCocos()`（装配 ByteArray、事件/异步加载订阅器、引擎 linker）；
- **`CocosUISystem`**（来自 `k-ui-framework-cocos`，仅当接入了 UI 包）— onLoad 时自动执行 `registerCocosUI()` 并创建 UIRoot 子树。

两个装配函数均幂等，可重复调用。

> **3.8 注意**：从 node_modules 加载的组件类没有编辑器注册帧，框架的 ccclass 装饰器会自动降级为透传（控制台输出 `[k-ts-framework-cocos] ccclass(...) 注册失败` 警告）。此时不要在场景里挂这两个组件，改在任一入口脚本（如场景入口组件的 `onLoad`/`start`）直接调用 `registerKFrameworkCocos()` / `registerCocosUI()`，装配效果相同。

### 6.5 编写第一个业务脚本

框架核心是 `System`（逻辑）+ `Store`（数据）+ 装饰器注册。在 Test 工程的 assets 下新建 `TestMain.ts`：

```ts
import { D, F } from "k-ts-framework";

@D.store()
export class TestStore extends F.Store {
    public count = 0;
}

@D.system("Test", TestStore)
export class TestSystem extends F.System {
    public init() {
        console.log("[Test] framework ready");
    }
}
```

> `D` 是装饰器入口（`D.store` / `D.system` / `D.linkUtil` 等），`F` 是框架命名空间。`System` 的生命周期回调为 `init` / `postInit` / `preUninit` / `uninit`，以 `packages/k-ts-framework/src/framework/System.ts` 为准。
>
> 注意：引擎触点一律经 linker/subscriber 注入，业务代码不要直接 `import "cc"` 去碰框架内部实现，统一走 `k-ts-framework-cocos` 暴露的 API。

### 6.6 挂一个 UI 面板（可选）

1. UI 面板 prefab 放到 `resources/ui/<uiTag>.prefab`（常量 `UI_PANEL_PREFIX`，默认 `"ui/"`，单点可改）；
2. wnd 模板经 `registerCocosUITemplate(tag, { wnd: { wndLayer } })` 逐 tag 注册（未注册默认 wndLayer 1）；
3. 业务里用 `getPrefabProxy<T>(store)` / `findPrefabProxy<T>(store)` 拿面板代理（`PrefabProxyEx`，含 Label/Sprite/Button/Toggle/Slider/EditBox/ScrollView 常用方法）。

**不要**自行 `linkUtil(getUITemplate)`——该 linker 已由 k-ui-framework-cocos 默认实现，linker 单链接，重复注册会在模块加载时断言失败。

### 6.7 接入热更新（可选）

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

`IFS` 在非 jsb 运行时（编辑器预览/web）统一外抛，按需在 `registerPatcherCocos({ ... })` 里覆盖回调。

### 6.8 运行验证

1. 回到 Creator 编辑器，点顶部中间 **预览** 按钮（浏览器预览）；
2. 控制台应输出 `[Test] framework ready`；
3. 原生平台（iOS/Android/Windows/macOS）或微信小游戏，用 **构建发布** 面板出包后验证（数据表 JSON 经 `F.Engine.readTextFile` 同步读取：原生走 `jsb.fileUtils`，编辑器/web 走 resources 已缓存的 TextAsset）。

至此 Test 项目已具备：Cocos 4.0 工程 + 框架装配 + 最小业务入口。后续按需接 `k-ui-framework`、`k-ts-protobuf`、`game-data-collection` + `k-export-flow` 等包。

## 7. 常见问题

| 现象                                                      | 原因 / 处理                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 子目录出现 `yarn.lock`                                    | 误在子目录执行了安装。删掉它，回到根目录重新 `yarn`                                                                                        |
| `patcher` / `patch-common` 测试、类型检查失败             | 缺 `LanguageDefine.ts`（消费项目注入），纯框架检出中属预期                                                                                 |
| TS 报 `cc` 类型重复声明                                   | include 了框架自带的 `typing/cocos/cc.d.ts`。消费项目不要 include，把它移出 typeRoots 链路，用 Cocos 工程自带的完整 cc 类型                |
| 模块加载时断言失败（重复注册 linker）                     | 自行注册了框架已默认实现的 linker（如 `getUITemplate`）。改用 `registerCocosUITemplate` 逐 tag 注册                                        |
| 想覆盖数据表 JSON 读取                                    | `F.Engine.readTextFile` linker 由 k-ts-framework-cocos 单点链接、不可再覆盖；JSON 级自定义读取走 game-data-collection 的 `setJsonLoadFunc` |
| 想直接依赖 node 内置模块（fs/path 等）                    | 不可以：目标运行时含微信小游戏与 Cocos 原生，不要依赖 node 内置模块                                                                        |
| lint 报 `jsb` 未定义                                      | 运行时全局已在 `.oxlintrc.json` 声明；新增引擎全局时同步该配置                                                                             |
| project-references 构建下调用增强 subscribe 重载报 TS2769 | ESM 化后增强说明符已带 `.js` 后缀、三条类型链路均能合并（见 AGENTS.md 技术债）；若仍遇到，参照 `k-ui-framework-cocos/CocosUISystem.ts` 显式透传绕过 |
| 想找回旧 Unity 版本                                       | `git checkout b31cb16`（迁移前的 Unity + Puerts 版本）                                                                                     |
