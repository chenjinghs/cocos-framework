import { Root } from "protobufjs";

// 定制版 pbjs 的 bin 脚本会注入 --no-create --no-verify --no-delimited --no-typeurl --no-service
// 这里在程序化调用时显式传入等价选项，保证与子进程调用完全一致
const STATIC_MODULE_OPTIONS = {
    keepCase: true,
    forceLong: true,
    "force-long": true,    // pbjs minimist 读 hyphen 格式
    wrap: "commonjs",
    // 与 pbjs 默认 lint 注释保持一致
    lint: "eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars",
    // 关闭不需要的生成项
    create: false,
    encode: true,
    decode: true,
    verify: false,
    convert: true,         // 保留 toObject（fromObject 已在 static.js 内删除）
    delimited: false,
    typeurl: false,
    beautify: true,
    comments: true,
    service: false,
    "null-defaults": false,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const staticModuleTarget = require("protobufjs/cli/targets/static-module");

/**
 * 使用 protobufjs static-module target 程序化生成 CommonJS JS bundle，
 * 等价于：pbjs -t static-module -w commonjs --keep-case --force-long
 *           --no-create --no-verify --no-delimited --no-typeurl --no-service
 */
export function generateStaticJsBundle(root: Root): string {
    let output = "";
    let caughtError: Error | null = null;

    staticModuleTarget(root, STATIC_MODULE_OPTIONS, (err: Error | null, result: string) => {
        if (err) {
            caughtError = err;
            return;
        }
        output = result;
    });

    if (caughtError) throw caughtError;
    return output;
}
