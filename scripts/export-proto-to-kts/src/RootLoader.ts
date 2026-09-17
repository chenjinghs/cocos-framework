import * as fs from "node:fs";
import * as path from "node:path";
import { Root } from "protobufjs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const protobuf = require("protobufjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const glob = require("glob");

/** 使用 glob@8 扩展（与 pbjs CLI 一致），用于生成 pb-bundle.js / pb-bundle.d.ts */
export function collectProtoFiles(sourceDir: string, protoRootPath: string, ignorePaths?: string[]): string[] {
    const resolvedIgnore = (ignorePaths ?? []).map((p) => path.resolve(p));
    const pattern = path.resolve(sourceDir).replace(/\\/g, "/") + "/**/*.proto";

    const absFiles: string[] = glob.sync(pattern);

    return absFiles
        .filter((f: string) => {
            const resolved = path.resolve(f);
            return !resolvedIgnore.some((ig) => resolved.startsWith(ig + path.sep) || resolved === ig);
        })
        .map((f: string) => path.relative(protoRootPath, f).replace(/\\/g, "/"));
}

/** 使用 fs.readdirSync 字母序扫描（与旧 ProtoExporter 一致），用于生成 index.ts / ProtoDescs.lua */
export function collectProtoFilesAlpha(sourceDir: string, protoRootPath: string, ignorePaths?: string[]): string[] {
    const files: string[] = [];
    collectAlphaRecursive(sourceDir, protoRootPath, ignorePaths ?? [], files);
    return files;
}

function collectAlphaRecursive(dir: string, protoRootPath: string, ignorePaths: string[], out: string[]) {
    const resolvedDir = path.resolve(dir);
    if (ignorePaths.some((p) => path.resolve(p) === resolvedDir)) return;
    if (!fs.existsSync(dir)) return;

    for (const name of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        if (fs.statSync(fullPath).isDirectory()) {
            collectAlphaRecursive(fullPath, protoRootPath, ignorePaths, out);
        } else if (fullPath.endsWith(".proto")) {
            out.push(path.relative(protoRootPath, fullPath).replace(/\\/g, "/"));
        }
    }
}

export function loadRoot(protoRootPath: string, relativeFiles: string[]): Root {
    const root: Root = new protobuf.Root();

    root.resolvePath = (_origin: string, target: string) => {
        // 处理 protobufjs 内置的 google 公共类型
        if (target.startsWith("google/protobuf/")) {
            const common = (protobuf as any).common;
            if (target in common) return target;
        }

        // 解析为绝对路径（相对于 protoRootPath）
        const abs = path.resolve(protoRootPath, target);
        if (fs.existsSync(abs)) return abs;

        // 尝试相对于 origin 文件目录解析（处理 proto import 语句）
        if (_origin && !_origin.startsWith("google/")) {
            const fromOrigin = path.resolve(path.dirname(_origin), target);
            if (fs.existsSync(fromOrigin)) return fromOrigin;
        }

        return abs;
    };

    const absFiles = relativeFiles.map((f) => path.resolve(protoRootPath, f));
    (root as any).loadSync(absFiles, { keepCase: true }).resolveAll();
    return root;
}
