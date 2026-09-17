import { assert } from "../global/GlobalFunctions";

type Constructor = new (...args: any[]) => any;

export class TagInfo {
    public tag!: string;
    public ctors: Constructor | Array<Constructor>;
    public instances = new Array<InstanceType<Constructor>>();

    public constructor(tag: string, ctor: Constructor | Array<Constructor>) {
        this.tag = tag;
        this.ctors = ctor;
    }

    public reset() {
        this.instances = [];
    }
}

export type TVerifyTagFunc = (tag: string) => void;

export class TagHelper {
    private _infos = new Map<string, TagInfo>();
    private _ctorToTag = new Map<Constructor, string>();

    // 有点恶心，开出去为了惰性require做的
    private _verifyTagFunc?: TVerifyTagFunc;

    public register(tag: string, ctor: Constructor) {
        assert(tag && ctor);
        let info = this._infos.get(tag);
        if (!info) {
            info = new TagInfo(tag, ctor);
            this._infos.set(tag, info);
        } else if (Array.isArray(info.ctors)) {
            assert(info.ctors.indexOf(ctor) < 0, "Duplicated registered system: " + ctor.name);
            info.ctors.push(ctor);
        } else {
            info.ctors = [info.ctors, ctor];
        }

        // 需要利用原始system的constructor拿到tag
        this._ctorToTag.set(ctor, tag);
    }

    public unregister(tagOrCtor: Constructor | string) {
        let ret = [];
        if (typeof tagOrCtor === "string") {
            let info = this._infos.get(tagOrCtor);
            if (info) {
                if (Array.isArray(info.ctors)) {
                    info.ctors.forEach((ctor) => {
                        ret.push(ctor);
                        this._ctorToTag.delete(ctor);
                    });
                } else {
                    ret.push(info.ctors);
                    this._ctorToTag.delete(info.ctors);
                }
                assert(info.instances.length === 0 || !info.instances.find((v) => v.system !== undefined), "There are still instances.");
                info.reset();
                this._infos.delete(tagOrCtor);
                console.log(`unregister tag ${tagOrCtor}`);
            }
        } else {
            let tag = this._ctorToTag.get(tagOrCtor);
            if (tag) {
                this._ctorToTag.delete(tagOrCtor);
                let info = this._infos.get(tag);

                if (info) {
                    console.log(`unregister ctor ${tagOrCtor.name}`);
                    assert(info.instances.length === 0 || !info.instances.find((v) => v.system !== undefined), "There are still instances.");
                    ret.push(tagOrCtor);

                    if (Array.isArray(info.ctors)) {
                        let index = info.ctors.indexOf(tagOrCtor);
                        assert(index >= 0);
                        info.ctors.splice(index, 1);
                        if (info.ctors.length === 1) {
                            info.ctors = info.ctors[0];
                        }
                    } else {
                        assert(info.ctors === tagOrCtor);
                        info.reset();
                        this._infos.delete(tag);
                    }
                }
            }
        }

        return ret;
    }

    public getTag(ctor: Constructor) {
        return this._ctorToTag.get(ctor);
    }

    public addInstance(instance: InstanceType<Constructor>) {
        assert(instance);
        let tag = this.getTag(instance.constructor);
        if (!tag) {
            return;
        }

        let info = this._infos.get(tag);
        assert(info);
        assert(info.instances.indexOf(instance) < 0);

        info.instances.push(instance);
    }

    public removeInstance(instance: InstanceType<Constructor>) {
        assert(instance);
        let tag = this.getTag(instance.constructor);
        if (!tag) {
            return;
        }

        let info = this._infos.get(tag);
        assert(info);
        let index = info.instances.findIndex((tempInstance: InstanceType<Constructor>) => {
            return tempInstance.id === instance.id;
        });
        assert(index >= 0);
        info.instances.splice(index, 1);
    }

    public addInfos<T extends Constructor>(source?: T | T[], added?: T | T[]): T | T[] | undefined {
        if (!added) {
            return source;
        }

        let ret = source;
        if (!ret) {
            return Array.isArray(added) ? [...added] : added;
        } else if (!Array.isArray(ret)) {
            ret = [ret];
        }

        if (Array.isArray(added)) {
            ret.concat(added);
        } else {
            ret.push(added);
        }
        return ret;
    }

    public printInfos(tag?: string) {
        if (tag) {
            let info = this._infos.get(tag);
            if (info) {
                console.log(`Tag [${info.tag}], number [${info.ctors.length}]`);
                if (Array.isArray(info.ctors)) {
                    info.ctors.forEach((v) => {
                        console.log("Ctor name: " + v.name);
                    });
                } else {
                    console.log("Ctor name: " + info.ctors.name);
                }
            } else {
                console.log(`Input tag ${tag} is invalid.`);
            }
        } else {
            // print all
            this._infos.forEach((_, tag) => {
                this.printInfos(tag);
            });
        }
    }

    // TODO: 暂时只支持静态数据拷贝
    public inheritFrom(source: TagHelper) {
        for (let v of source._infos) {
            let newTagInfo = new TagInfo(v[1].tag, v[1].ctors);
            // TODO: 这里需不需要弄一套新的system出来？
            // if (withInstance) newTagInfo.instances = new Array(v[1].instances);
            this._infos.set(v[0], newTagInfo);
        }
        for (let v of source._ctorToTag) {
            this._ctorToTag.set(v[0], v[1]);
        }
    }

    public findCtorsByTag<T extends Constructor>(tag: string): T | T[] | undefined {
        if (this._verifyTagFunc) this._verifyTagFunc(tag);

        let info = this._infos.get(tag);
        return info?.ctors as T | T[];
    }

    public findInstancesByTag(tag: string) {
        // 按说tag没有，instance肯定没有，所以这里没有verify
        // if (this._verifyTagFunc) this._verifyTagFunc(tag);
        return this._infos.get(tag)?.instances;
    }

    public findInfoByTag(tag: string) {
        if (this._verifyTagFunc) this._verifyTagFunc(tag);

        return this._infos.get(tag);
    }

    public setVerifyTagFunc(func: TVerifyTagFunc) {
        this._verifyTagFunc = func;
    }

    public getAllInstances() {
        let ret = new Array<any>();
        for (let [_, info] of this._infos) {
            ret = ret.concat(info.instances);
        }
        return ret;
    }
}
