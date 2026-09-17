import { Root } from "protobufjs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const proto3Target = require("protobufjs/cli/targets/proto3");

/**
 * 程序化生成合并后的 proto3 文件，等价于：
 * pbjs -t proto3 --keep-case -p protoRootPath protoGlob
 */
export function generateMonoProto(root: Root): string {
    let output = "";
    let caughtError: Error | null = null;

    proto3Target(root, { keepCase: true }, (err: Error | null, result: string) => {
        if (err) {
            caughtError = err;
            return;
        }
        output = result;
    });

    if (caughtError) throw caughtError;
    return output;
}
