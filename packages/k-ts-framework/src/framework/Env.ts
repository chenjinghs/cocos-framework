/* eslint-disable @typescript-eslint/member-ordering */
import { assert } from "../global/GlobalFunctions.js";
import { Constructor, EDataInheritType, EEnvType, getManager, IEnv, IEnvData } from "./Interface.js";

const TEMP_ENV_NAME = "__temp";

class EnvScope {
    private static maxHandle = 0;
    public tempEnv?: Env;
    public handle: number;

    public constructor(public savedEnv: Env, public targetEnvs: Env[]) {
        this.handle = ++EnvScope.maxHandle;
    }
}

/**
 * 运行环境，类似lua的_G
 * 在加载脚本时脚本可以往此里写入自己需要的数据
 * 目的：当单机模式下，需要起两套环境（logic-server以及client），两套环境有共用(common)和不共用部分(logic-server和client)
 * 为了防止污染，每套环境都有自己的env，并且继承common，这样两套环境就可以独立运作
 */
export class Env implements IEnv {
    private static envs = new Array<Env>();
    private static currentEnv: Env;
    private static sharedData = new Map<Constructor<IEnvData>, IEnvData>();
    private static _innerEnv: Env | undefined;
    private static scopes = new Array<EnvScope>(); // 因为有可能嵌套，所以是个栈

    private innerName: string;
    private innerType: number;
    private innerValid: boolean = true;

    public get name() {
        return this.innerName;
    }
    public get type() {
        return this.innerType;
    }
    public get valid() {
        return this.innerValid;
    }

    private data = new Map<Constructor<IEnvData>, IEnvData>();

    /**
     * 创建环境
     * @param name 名称
     * @param type 环境类型
     * @param inheritEnv 继承的env，如果填了此选项，则新创建的env拥有被继承env的数据
     * @param dataInheritType 如何继承数据
     * @returns 模板数据
     */
    public static create(
        name: string,
        type: number,
        inheritEnv: string | undefined = undefined,
        switchEnv: boolean = true,
        dataInheritType = EDataInheritType.StaticData,
    ): Env {
        assert(!this.findByName(name), `duplicated template module name [${name}]`);

        let ret = new Env(name, type);
        this.envs.push(ret);

        ret.inheritFrom(this.innerEnv, EDataInheritType.StaticData);

        if (inheritEnv) {
            ret.inheritFrom(this.findByName(inheritEnv), dataInheritType);
        }

        if (switchEnv) {
            this.current = ret;
            getManager().onEnvInit(ret, true);
        } else {
            this.scope(ret, () => {
                getManager().onEnvInit(ret, true);
            });
        }
        
        return ret;
    }

    /**
     * 删除环境
     * @param name 名称
     * @returns 删除是否成功
     */
    public static destroy(name: string): boolean {
        let index = this.envs.findIndex((v) => v.name === name);
        if (index < 0) return false;

        let env = this.envs[index];
        getManager().onEnvUninit(env);
        env.data.clear();
        env.innerValid = false;
        this.envs.splice(index, 1);
        return true;
    }

    /**
     * 删除所有
     */
    public static destroyAll() {
        let count = this.envs.length;
        for (let i = count - 1; i >= 0; --i) {
            let env = this.envs[i];
            getManager().onEnvUninit(env);
            env.data.clear();
            env.innerValid = false;
        }
        this.envs.length = 0;
    }

    /**
     * 获取当前环境
     * @returns 环境数据
     */
    public static get current(): Env {
        if (!this.currentEnv) {
            this.currentEnv = this.innerEnv;
        }
        return this.currentEnv;
    }

    /**
     * 设置当前环境
     * @param env: 环境
     */
    public static set current(env: Env) {
        assert(env !== undefined, "can not set empty env");
        this.currentEnv = env;
    }

    /**
     * 获取当前环境类型
     */
    public static get currentType(): number {
        return this.current.type;
    }

    /**
     * 获取当前环境里的自定义数据（不存在则创建个新的）
     * @param type
     * @returns 自定义数据
     */
    public static getCurrentData<T extends IEnvData>(type: Constructor<T>): T {
        return this.currentEnv.getData(type);
    }

    /**
     * 获取所有环境里的共享数据（不存在则创建个新的）
     * @param type
     * @returns 自定义数据
     */
    public static getSharedData<T extends IEnvData>(type: Constructor<T>): T {
        let ret = this.sharedData.get(type);
        if (ret === undefined) {
            ret = new type();
            this.sharedData.set(type, ret);
        }
        return ret as unknown as T;
    }

    /**
     * 查找环境数据
     * @param name 名称
     * @returns 环境数据
     */
    public static findByName(name: string): Env | undefined {
        return this.envs.find((v) => v.name === name);
    }

    /**
     * 查找环境数据
     * @param type 类型
     * @returns 环境数据
     */
    public static findByType(type: number): Env | undefined {
        return this.envs.find((v) => v.type === type);
    }

    /**
     * 查找环境数据
     * @param type 类型
     * @returns 环境数据数组
     */
    public static findMultiByType(type: number): Env[] {
        let ret: Env[] = [];
        this.envs.forEach((v) => {
            if ((v.type & type) !== 0) {
                ret.push(v);
            }
        });
        return ret;
    }

    /**
     * 获取全部环境数据
     * @returns 环境数据
     */
    public static getAllEnvInfo(): Array<Env> {
        return this.envs;
    }

    /**
     * 查找环境
     * @param env 可以是类型或者名字
     * @returns 查找结果
     */
    public static find(env: number | string | Env): Env[] {
        let envs = new Array<Env>();
        let t = typeof env;
        if (t === "number") {
            for (let e of this.envs) {
                if ((e.type & (env as number)) !== 0) {
                    envs.push(e);
                }
            }
        } else if (t === "string") {
            let e = this.findByName(env as string);
            if (e) envs.push(e);
        } else {
            if (env) envs.push(env as Env);
        }
        return envs;
    }

    /**
     * 获取内部默认的Env
     */
    private static get innerEnv(): Env {
        if (this._innerEnv === undefined) {
            this._innerEnv = new Env("__innerEnv", EEnvType.Default);
            getManager().onEnvInit(this.innerEnv, false);
        }
        return this._innerEnv;
    }

    /**
     * 在指定环境下执行函数，执行完在切回原始环境
     * @param env 指定环境
     * @param func 函数
     * @returns 处理是否成功
     */
    public static scope(env: number | string | Env, func: () => void): boolean {
        let envs = this.find(env);
        if (envs.length === 0) {
            return false;
        } else if (envs.length === 1) {
            this.scopeImp(envs[0], func);
        } else {
            for (let env of envs) {
                this.scopeImp(env, func);
            }
        }

        return true;
    }

    /**
     * 局部模块执行用
     * @param env
     * @param func
     */
    private static scopeImp(env: Env, func: () => void) {
        let oldEnv = this.current;
        this.current = env;

        try {
            func();
        } catch (error: any) {
            if (error.message.includes("stack:")) console.error(error.message);
            else console.error(`${error.message}\n${error.stack}`);
        }

        this.current = oldEnv;
    }

    /**
     * 指定某环境开始
     * @param env 指定环境
     * @returns scope handle
     */
    public static scopeBegin(env: number | string | Env): number {
        let targetEnvs = this.find(env);
        let scope = new EnvScope(this.current, targetEnvs);
        this.scopes.push(scope);

        if (targetEnvs.length === 1) {
            // 如果只有一个则直接切过去，不弄临时Env了
            scope.tempEnv = targetEnvs[0];
        } else {
            scope.tempEnv = new Env(TEMP_ENV_NAME, 0);
        }
        this.current = scope.tempEnv;
        return scope.handle;
    }

    /**
     * 指定某环境结束
     * @param handle scope handle
     */
    public static scopeEnd(handle: number) {
        let scope = this.scopes.pop();
        assert(scope && scope.handle === handle, `invalid scope end, please check input scope handle`);

        if (scope.targetEnvs.length === 1) {
            assert(scope.tempEnv === scope.targetEnvs[0]);
            this.current = scope.savedEnv;
        } else {
            if (scope.targetEnvs.length === 0) {
                // 没有找到目标env，直接什么都不做，相当于丢弃tempEnv
            } else {
                for (let targetEnv of scope.targetEnvs) {
                    targetEnv.inheritFrom(scope.tempEnv, EDataInheritType.All);
                }
            }
        }
    }

    /**
     * 构造函数
     * @param name 名称
     * @param type 类型
     */
    public constructor(name: string, type: number) {
        this.innerName = name;
        this.innerType = type;
    }

    /**
     * 获取当前环境里的自定义数据（不存在则创建个新的）
     * @param type
     * @returns 自定义数据
     */
    public getData<T extends IEnvData>(type: Constructor<T>, createIfNotExists = true): T {
        let ret = this.data.get(type);
        if (ret === undefined && createIfNotExists) {
            ret = new type();
            this.data.set(type, ret);
        }
        return ret as unknown as T;
    }

    /**
     * 继承目标环境
     * @param source 目标环境
     * @param dataInheritType 继承类型
     */
    public inheritFrom(source: Env | undefined, dataInheritType: EDataInheritType) {
        if (!source || dataInheritType === EDataInheritType.None) return;

        for (let v of source.data) {
            let ctor = v[0];
            let targetData = new ctor();
            targetData.inheritFrom(v[1], dataInheritType);
            this.data.set(ctor, targetData);
        }
    }
}
