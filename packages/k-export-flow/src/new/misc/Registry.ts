type Constructor<T = any> = new (...args: any[]) => T;

// 因为TBase大部分是虚类，直接用正常写法编不过去，所以这里写的比较别扭
export class Registry {
    public static ctorToRegistry = new Map<any, Registry>();
    public static get<T>(ctor: T) {
        let registry = Registry.ctorToRegistry.get(ctor);
        if (!registry) {
            registry = new Registry();
            Registry.ctorToRegistry.set(ctor, registry);
        }
        return registry;
    }

    public static tryResetAll() {
        for (let registry of Registry.ctorToRegistry.values()) {
            for (const [_, ctor] of registry.nameToCtor) {
                if ((ctor as any).reset) (ctor as any).reset();
            }
        }
    }

    public nameToCtor = new Map<string, Constructor>();
    public register<T extends Constructor>(ctor: T, key?: string) {
        let k = key ?? ctor.name;
        if (this.nameToCtor.has(k)) throw new Error(`register duplicated, name: ${ctor.name}`);
        this.nameToCtor.set(k, ctor);
    }

    public create<T>(type: string) {
        let ctor = this.nameToCtor.get(type) as Constructor;
        if (ctor) return new ctor() as T;
        else return undefined;
    }
}
