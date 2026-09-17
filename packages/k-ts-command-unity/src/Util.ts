import { F } from "k-ts-framework";

import { CommandInfo, CommandRegistry, ICommandRouter } from "./Define";

const CommandSenderIdKey = Symbol("CommandSenderId");
const BOOLEAN_REGEX = /^\s*(true|1|on)\s*$/i;

interface ICommandAction {
    [CommandSenderIdKey]?: number;
}

/**
 * @deprecated 废弃
 * Server端解析 Command 时对 action 写入对应的 SenderId
 * @param action
 * @returns
 */
export function setCommandSenderId<T extends F.Action<unknown> & ICommandAction>(action: T, senderId?: number) {
    action[CommandSenderIdKey] = senderId;
}

/**
 * @deprecated 废弃
 * Server端执行时获取 Command 对应的 SenderId
 * @param action
 * @returns
 */
export function getCommandSenderId(action: F.Action<unknown>) {
    let commandAction = action as unknown as ICommandAction;
    return commandAction[CommandSenderIdKey];
}

/**
 * 获取已注册的所有 Command 记录
 * @returns
 */
export function getAllCommandRecords(): ReadonlyMap<string, CommandInfo> {
    return F.Env.getCurrentData(CommandRegistry).infos;
}

/**
 * 注册Command路由
 * @param router 路由
 */
export function registerCommandRouter(router: ICommandRouter) {
    F.assert(router);
    let routers = F.Env.getCurrentData(CommandRegistry).routers;
    let index = routers.indexOf(router);
    if (index < 0) F.Env.getCurrentData(CommandRegistry).routers.push(router);
}

/**
 * 取消Command路由
 * @param router 路由
 */
export function unregisterCommandRouter(router: ICommandRouter) {
    F.assert(router);
    let routers = F.Env.getCurrentData(CommandRegistry).routers;
    let index = routers.indexOf(router);
    if (index >= 0) routers.splice(index, 1);
}

/**
 * 根据CommandInfo以及输入参数构造Action，并执行
 * @param info CommandInfo
 * @param strParams 输入参数
 * @returns Action返回值
 */
export function constructCommandAction(info: CommandInfo, strParams: string[]): F.Action<unknown> {
    F.assert(info);
    let params = info.paramTypes.map((type, i) => {
        let strParam = strParams[i];
        switch (type) {
            case Number:
                return Number(strParam);
            case Boolean:
                return BOOLEAN_REGEX.test(strParam);
            case String:
            default:
                return strParam ?? "";
        }
    });
    return new info.target(...params);
}

/**
 * 将输入命令分割成数组
 * @param command 输入命令
 * @returns 参数数组
 */
export function splitCommandParams(command: string): string[] {
    const COMMAND_SPLITTER = /\s+/;
    return command.split(COMMAND_SPLITTER);
}
