import { F } from "k-ts-framework";

/**
 * 管理 CommandSystem 的 Tag
 */
export const COMMAND_SYSTEM_TAG = "CommandSystemTag";

export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * 单个Command注册信息
 */
export class CommandInfo {
    public constructor(
        public command: string,
        public target: Constructor<F.Action<unknown>>,
        public paramTypes: Array<unknown>,
        public desc: string,
    ) {}
}

/**
 * 所有Command信息都注册在这里
 */
export class CommandRegistry implements F.IEnvData {
    public infos = new Map<string, CommandInfo>();
    public routers = new Array<ICommandRouter>();

    inheritFrom(source: CommandRegistry) {
        for (let v of source.infos) {
            this.infos.set(v[0], v[1]);
        }
    }
}

/**
 * 转发命令需要实现此类，并调用Util.registerCommandRouter
 */
export interface ICommandRouter {
    /**
     * 转发
     * @param params 字符串参数数组
     * @param allInfos 所有命令信息
     * @param originalCommand 原始输入命令
     * @return 是否执行成功
     */
    route(params: string[], allInfos: Map<string, CommandInfo>, originalCommand?: string): boolean;
}
