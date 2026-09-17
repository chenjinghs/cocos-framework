import "reflect-metadata";

import { F } from "k-ts-framework";

import { CommandInfo, CommandRegistry, Constructor } from "./Define";

/**
 * 有效的 Command 参数类型
 */
const VALID_PARAM_TYPES = [Number, String, Boolean];

/**
 * 注册一个 Command Action
 * @param command 命令
 * @param desc 命令描述
 * @returns
 */
export function command(command: string, desc: string) {
    return (target: Constructor<F.Action<unknown>>) => {
        let paramTypes = Reflect.getMetadata("design:paramtypes", target) as Array<any>;
        if (paramTypes) {
            for (let ParamType of paramTypes) {
                if (ParamType! in VALID_PARAM_TYPES) {
                    console.error(`unsupported command param type: ${command}, ${ParamType.name}`);
                    return;
                }
            }
        } else {
            paramTypes = [];
        }

        let lowerCommand = command.toLowerCase();
        let propertyDesc = paramTypes?.length > 0 ? ` {${paramTypes.map((v) => v.name).join(", ")}}` : "";
        let commandRecord = new CommandInfo(lowerCommand, target, paramTypes, desc + propertyDesc);
        F.Env.getCurrentData(CommandRegistry).infos.set(lowerCommand, commandRecord);
    };
}
