import { Constructor, RuleType, ValueType } from "./Define";
import { D, F } from "k-ts-framework";
import { Root, Type } from "protobufjs";


export class FieldInfo {
    public constructor(
        public name: string,
        public valueType: ValueType | Constructor,
        public rule: RuleType,
        public id?: number,
    ) {}
}

export class MapInfo extends FieldInfo {
    public keyType: ValueType;

    public constructor(
        name: string,
        keyType: ValueType,
        valueType: ValueType | Constructor,
        rule: RuleType,
        id?: number,
    ) {
        super(name, valueType, rule, id);
        this.keyType = keyType;
    }
}

export class MessageInfo {
    public fields = new Array<FieldInfo>();

    public constructor(public target: Constructor, public name: string, public id?: number) {}
}

export class PackageInfo {
    public constructor(public name: string, public messages = new Array<MessageInfo>()) {}
}

export class ProtoBufRegistry implements F.IEnvData {
    public packageInfos = new Array<PackageInfo>();
    public ctorToMessageInfo = new Map<Constructor, MessageInfo>();

    public inheritFrom(source: ProtoBufRegistry) {
        for (const v of source.packageInfos) {
            if (this.packageInfos.indexOf(v) < 0) {
                this.packageInfos.push(v);
            }
        }

        for (const v of source.ctorToMessageInfo) {
            if (!this.ctorToMessageInfo.has(v[0])) {
                this.ctorToMessageInfo.set(v[0], v[1]);
            }
        }
    }
}

@D.store()
export class ProtobufStore extends F.SingletonStore {
    public root?: Root;

    // 底下这几个都是为了访问快
    public ctorToPBMessageType = new Map<Constructor, Type>();
    public ctorToMessageId = new Map<Constructor, number>();
    public messageIdToCtor = new Map<number, Constructor>();
    public nameToCtor = new Map<string, Constructor>();
}
