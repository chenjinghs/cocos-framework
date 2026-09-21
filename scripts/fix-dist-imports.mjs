// dist 跨包导入改写：Creator 3.8 编辑器 executor 的兼容步骤
//
// 背景：3.8 编辑器目标（scene 进程 / PreviewInEditor）按包拆 chunk，包间依赖保留
// 裸名（如 "k-ts-framework"）；该上下文解析不了"node_modules 模块发起的裸包名导入"
// （assets 脚本发起的可以，CJS 时代有 CjsLoader.require 兜底，ESM 没有），导致
// 依赖 setter 不执行、模块顶层拿到的绑定是 undefined（如 F.Store extends 崩溃）。
// 预览目标（浏览器）把包合并为单 chunk 所以不受影响。
//
// 做法：把运行时 5 包 dist 里的跨包裸导入改写为**相对路径**（文件级依赖，所有
// 目标/环境都能解析：编辑器打包器、预览合并、真 ESM 的 Node/4.0）。
// 在 tsc -b 之后运行：node scripts/fix-dist-imports.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const root = join(import.meta.dirname, "..");
const PACKAGES = [
    { name: "k-ts-framework", entry: "dist/index.js" },
    { name: "k-ts-framework-cocos", entry: "dist/index.js" },
    { name: "k-ui-framework", entry: "dist/index.js" },
    { name: "k-ui-framework-cocos", entry: "dist/index.js" },
    { name: "game-data-collection", entry: "dist/index.js" },
];

function* walk(dir) {
    for (const item of readdirSync(dir)) {
        const full = join(dir, item);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (item.endsWith(".js")) yield full;
    }
}

let rewritten = 0;
for (const pkg of PACKAGES) {
    const distDir = join(root, "packages", pkg.name, "dist");
    for (const file of walk(distDir)) {
        let code = readFileSync(file, "utf8");
        let changed = false;
        for (const dep of PACKAGES) {
            if (dep.name === pkg.name) continue;
            // 匹配 import ... from "dep" / export ... from "dep" / import "dep"
            const pattern = new RegExp(`(from\\s*|import\\s*)"${dep.name}"`, "g");
            code = code.replace(pattern, (_m, prefix) => {
                // 目标包入口的绝对路径 → 相对于当前文件
                const rel = relative(dirname(file), join(root, "packages", dep.name, dep.entry)).replaceAll("\\", "/");
                changed = true;
                rewritten++;
                return `${prefix}"${rel}"`;
            });
        }
        if (changed) writeFileSync(file, code);
    }
}
console.log(`fix-dist-imports: ${rewritten} 处跨包裸导入已改写为相对路径`);
