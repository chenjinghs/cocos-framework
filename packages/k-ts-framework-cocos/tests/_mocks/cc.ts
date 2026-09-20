/**
 * 测试用最小 cc 假实现：Node 树 + EventTarget 为真实现，其余为桩。
 * 通过 tsconfig.test.json 的 paths 注入，生产环境由真实引擎提供。
 */

export class Event {
    public type: string;
    public target: unknown;
    public currentTarget: unknown;
    public constructor(type: string) {
        this.type = type;
    }
}
export class EventTouch extends Event {
    public getLocation(): Vec2 {
        return new Vec2();
    }
}
export class EventMouse extends Event {
    public getLocation(): Vec2 {
        return new Vec2();
    }
}

type EventCallback = (...args: unknown[]) => void;

export class EventTarget {
    private listeners = new Map<string, Array<{ callback: EventCallback; target?: unknown }>>();

    public on(type: string, callback: EventCallback, target?: unknown, _once?: boolean): void {
        let list = this.listeners.get(type) ?? [];
        list.push({ callback, target });
        this.listeners.set(type, list);
    }

    public once(type: string, callback: EventCallback, target?: unknown): void {
        let wrapped: EventCallback = (...args) => {
            this.off(type, wrapped, target);
            callback(...args);
        };
        this.on(type, wrapped, target);
    }

    public off(type: string, callback?: EventCallback, target?: unknown): void {
        if (callback === undefined) {
            this.listeners.delete(type);
            return;
        }
        let list = this.listeners.get(type) ?? [];
        this.listeners.set(
            type,
            list.filter((v) => v.callback !== callback || (target !== undefined && v.target !== target)),
        );
    }

    public emit(type: string, ...args: unknown[]): void {
        let list = this.listeners.get(type) ?? [];
        for (let v of [...list]) v.callback(...args);
    }

    public targetOff(target: unknown): void {
        for (let [type, list] of this.listeners) {
            this.listeners.set(
                type,
                list.filter((v) => v.target !== target),
            );
        }
    }

    public hasEventListener(type: string, callback?: EventCallback, target?: unknown): boolean {
        let list = this.listeners.get(type) ?? [];
        return list.some((v) => (callback === undefined || v.callback === callback) && (target === undefined || v.target === target));
    }
}

export class EventHandler {
    public target: Node | null = null;
    public component = "";
    public handler = "";
    public customEventData = "";
    public static emitEvents(events: EventHandler[] | undefined, ..._args: unknown[]): void {
        for (let _event of events ?? []) {
            // 测试桩：不触发真实组件回调
        }
    }
}

export class Color {
    public constructor(
        public r = 0,
        public g = 0,
        public b = 0,
        public a = 255,
    ) {}
}
export class Vec2 {
    public constructor(
        public x = 0,
        public y = 0,
    ) {}
}
export class Vec3 {
    public constructor(
        public x = 0,
        public y = 0,
        public z = 0,
    ) {}
}
export class Size {
    public constructor(
        public width = 0,
        public height = 0,
    ) {}
}
export class Rect {
    public constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
    ) {}
}

export class Asset {
    public name = "";
    public nativeUrl = "";
    public uuid = "";
    public refCount = 0;
    private destroyed = false;
    public destroy(): boolean {
        this.destroyed = true;
        return true;
    }
    public addRef(): Asset {
        this.refCount++;
        return this;
    }
    public decRef(): Asset {
        this.refCount--;
        return this;
    }
    public get isDestroyed(): boolean {
        return this.destroyed;
    }
}
export class Prefab extends Asset {
    public data: unknown;
}
export class ImageAsset extends Asset {
    public width = 0;
    public height = 0;
}
export class Texture2D extends Asset {
    public image: ImageAsset | null = null;
    public width = 0;
    public height = 0;
}
export class SpriteFrame extends Asset {
    public texture: Texture2D | null = null;
}
export class JsonAsset extends Asset {
    public json: unknown;
}
export class TextAsset extends Asset {
    public text = "";
}

type ComponentConstructor<T extends Component> = new (...args: never[]) => T;

export class Component extends EventTarget {
    public node!: Node;
    public name = "";
    public enabled = true;
    public enabledInHierarchy = true;
    public onLoad(): void {}
    public start(): void {}
    public update(_dt: number): void {}
    public onDestroy(): void {}
    public onEnable(): void {}
    public onDisable(): void {}

    public getComponent<T extends Component>(type: ComponentConstructor<T>): T | null {
        return this.node.getComponent(type);
    }
    public getComponents<T extends Component>(type: ComponentConstructor<T>): T[] {
        return this.node.getComponents(type);
    }
    public getComponentInChildren<T extends Component>(type: ComponentConstructor<T>): T | null {
        return this.node.getComponentInChildren(type);
    }
    public getComponentsInChildren<T extends Component>(type: ComponentConstructor<T>): T[] {
        return this.node.getComponentsInChildren(type);
    }
}

export class Node extends EventTarget {
    public name: string;
    public active = true;
    public layer = 0;
    public uuid = "";
    public parent: Node | null = null;
    private childList: Node[] = [];
    private componentList: Component[] = [];
    private destroyed = false;

    public constructor(name = "") {
        super();
        this.name = name;
    }

    public get activeInHierarchy(): boolean {
        if (!this.active) return false;
        return this.parent ? this.parent.activeInHierarchy : true;
    }

    public get children(): readonly Node[] {
        return this.childList;
    }

    public get components(): readonly Component[] {
        return this.componentList;
    }

    public get scene(): Scene | null {
        let root = findRootNode(this);
        return root instanceof Scene ? root : null;
    }

    public addChild(child: Node): void {
        child.removeFromParent();
        child.parent = this;
        this.childList.push(child);
    }

    public removeChild(child: Node): void {
        let index = this.childList.indexOf(child);
        if (index >= 0) {
            this.childList.splice(index, 1);
            child.parent = null;
        }
    }

    public removeFromParent(): void {
        this.parent?.removeChild(this);
    }

    public removeAllChildren(): void {
        for (let child of [...this.childList]) this.removeChild(child);
    }

    public getChildByName(name: string): Node | null {
        return this.childList.find((v) => v.name === name) ?? null;
    }

    public getChildByPath(path: string): Node | null {
        return getChildBySegments(this, path.split("/"));
    }

    public getChildByUuid(uuid: string): Node | null {
        if (this.uuid === uuid) return this;
        for (let child of this.childList) {
            let found = child.getChildByUuid(uuid);
            if (found) return found;
        }
        return null;
    }

    public getComponent<T extends Component>(type: ComponentConstructor<T>): T | null {
        return (this.componentList.find((v) => v instanceof type) as T | undefined) ?? null;
    }

    public getComponents<T extends Component>(type: ComponentConstructor<T>): T[] {
        return this.componentList.filter((v) => v instanceof type) as T[];
    }

    public getComponentInChildren<T extends Component>(type: ComponentConstructor<T>): T | null {
        let direct = this.getComponent(type);
        if (direct) return direct;
        for (let child of this.childList) {
            let found = child.getComponentInChildren(type);
            if (found) return found;
        }
        return null;
    }

    public getComponentsInChildren<T extends Component>(type: ComponentConstructor<T>): T[] {
        let ret = this.getComponents(type);
        for (let child of this.childList) ret.push(...child.getComponentsInChildren(type));
        return ret;
    }

    public addComponent<T extends Component>(type: ComponentConstructor<T>): T {
        let component = new type();
        component.node = this;
        this.componentList.push(component);
        return component;
    }

    public removeComponent(component: Component): void {
        let index = this.componentList.indexOf(component);
        if (index >= 0) this.componentList.splice(index, 1);
    }

    public destroy(): boolean {
        if (this.destroyed) return false;
        this.destroyed = true;
        this.removeFromParent();
        for (let child of [...this.childList]) child.destroy();
        return true;
    }

    public get isDestroyed(): boolean {
        return this.destroyed;
    }

    public isChildOf(parent: Node): boolean {
        return isAncestorOf(parent, this);
    }

    public setSiblingIndex(index: number): void {
        if (!this.parent) return;
        let list = this.parent.childList;
        let current = list.indexOf(this);
        if (current < 0) return;
        list.splice(current, 1);
        list.splice(Math.max(0, Math.min(index, list.length)), 0, this);
    }

    public getSiblingIndex(): number {
        return this.parent ? this.parent.childList.indexOf(this) : 0;
    }

    public walk(callback: (node: Node) => void): void {
        callback(this);
        for (let child of this.childList) child.walk(callback);
    }
}

export class Scene extends Node {
    public isValid = true;
}

function cloneNode(source: Node): Node {
    let node = new Node(source.name);
    node.active = source.active;
    node.layer = source.layer;
    for (let component of source.components) {
        node.addComponent(component.constructor as new (...args: never[]) => Component);
    }
    for (let child of source.children) {
        node.addChild(cloneNode(child));
    }
    return node;
}

export function instantiate(original: Prefab | Node): Node {
    let source = original instanceof Prefab ? (original.data as Node) : original;
    return cloneNode(source);
}

/** 沿父链找到根节点 */
function findRootNode(node: Node): Node {
    while (node.parent) node = node.parent;
    return node;
}

/** 逐级按名字段查找子节点 */
function getChildBySegments(root: Node, segments: string[]): Node | null {
    let current: Node | null = root;
    for (let segment of segments) {
        if (!segment) continue;
        current = current.getChildByName(segment);
        if (current === null) return null;
    }
    return current;
}

/** parent 是否位于 node 的父链上 */
function isAncestorOf(parent: Node, node: Node): boolean {
    let current: Node | null = node.parent;
    while (current) {
        if (current === parent) return true;
        current = current.parent;
    }
    return false;
}

export function isValid(value: unknown, _strictOrLoose?: boolean): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "object" && "destroyed" in value) {
        let destroyed: unknown = value.destroyed;
        return typeof destroyed === "boolean" ? !destroyed : true;
    }
    return true;
}

class Director extends EventTarget {
    public currentScene: Scene | null = null;
    public getScene(): Scene | null {
        return this.currentScene;
    }
    public loadScene(sceneName: string, onLaunched?: (err?: Error | null) => void, _onUnloaded?: (err?: Error | null) => void): void {
        let scene = new Scene(sceneName);
        this.currentScene = scene;
        queueMicrotask(() => onLaunched?.());
    }
    public addPersistRootNode(_node: Node): void {}
    public removePersistRootNode(_node: Node): void {}
}
export const director = new Director();

export class Game extends EventTarget {}
export const game = new Game();

/** 平台信息（测试桩） */
export const sys: {
    os: string;
    osMainVersion: number;
    platform: number;
    language: string;
    isNative: boolean;
    isBrowser: boolean;
} = {
    os: "Windows",
    osMainVersion: 11,
    platform: 0,
    language: "zh",
    isNative: false,
    isBrowser: true,
};

export class Bundle extends Asset {
    public name = "";
    private assets = new Map<string, Asset>();

    public load(path: string, onComplete?: (err: Error | null, asset: Asset | null) => void): void;
    public load(path: string, type: unknown, onComplete?: (err: Error | null, asset: Asset | null) => void): void;
    public load(path: string, ...args: Array<unknown>): void {
        let onComplete = args.find((v): v is (err: Error | null, asset: Asset | null) => void => typeof v === "function");
        let asset = this.assets.get(path);
        queueMicrotask(() => {
            if (asset) {
                asset.uuid = path; // 引擎按 uuid 缓存,mock 用路径作 uuid
                assetManager.assets.set(asset.uuid, asset);
                onComplete?.(null, asset);
            } else onComplete?.(new Error(`asset not found: ${path}`), null);
        });
    }

    public loadDir(_path: string, ..._args: unknown[]): void {
        // 测试桩：不实现目录加载
    }

    /** 测试辅助：预置资源 */
    public setAssetForTest(path: string, asset: Asset): void {
        this.assets.set(path, asset);
    }

    /** 测试辅助：同步查缓存（模拟引擎缓存查询） */
    public get(path: string, _type: unknown): Asset | undefined {
        return this.assets.get(path);
    }
}

class AssetManager {
    private bundles = new Map<string, Bundle>();
    public loadBundle(name: string, onComplete?: (err: Error | null, bundle: Bundle | null) => void): void;
    public loadBundle(name: string, options: Record<string, unknown>, onComplete?: (err: Error | null, bundle: Bundle | null) => void): void;
    public loadBundle(name: string, ...args: Array<unknown>): void {
        let onComplete = args.find((v): v is (err: Error | null, bundle: Bundle | null) => void => typeof v === "function");
        let bundle = this.bundles.get(name);
        queueMicrotask(() => {
            if (bundle) onComplete?.(null, bundle);
            else onComplete?.(new Error(`bundle not found: ${name}`), null);
        });
    }
    public getBundle(name: string): Bundle | null {
        return this.bundles.get(name) ?? null;
    }
    public removeBundle(bundle: Bundle): void {
        this.bundles.delete(bundle.name);
    }
    public releaseAsset(asset: Asset): void {
        // 引擎实测语义(3.8.8):释放 = 从缓存逐出,不动 refCount,不 destroy
        this.assets.delete(asset.uuid);
    }
    public releaseAll(): void {
        this.assets.clear();
    }

    /** 全局资产缓存(模拟引擎 assetManager.assets,按 uuid 索引) */
    public readonly assets = new Map<string, Asset>();


    /** 测试辅助：注册 bundle */
    public addBundleForTest(bundle: Bundle): void {
        this.bundles.set(bundle.name, bundle);
    }
}
export const assetManager = new AssetManager();

const resourcesBundle = new Bundle();
resourcesBundle.name = "resources";
export const resources: Bundle = resourcesBundle;

export class UITransform extends Component {
    public width = 0;
    public height = 0;
    public contentSize = new Size();
    public setContentSize(width: number | Size, height?: number): void {
        if (width instanceof Size) this.contentSize = width;
        else this.contentSize = new Size(width, height ?? 0);
    }
}
export class Canvas extends Component {
    public cameraComponent: unknown = null;
}
export class Widget extends Component {
    public isAlignTop = false;
    public isAlignBottom = false;
    public isAlignLeft = false;
    public isAlignRight = false;
    public top = 0;
    public bottom = 0;
    public left = 0;
    public right = 0;
}
export class Label extends Component {
    public string = "";
    public color = new Color();
    public fontSize = 16;
    public lineHeight = 16;
}
export class Sprite extends Component {
    public spriteFrame: SpriteFrame | null = null;
    public color = new Color();
}
export class Button extends Component {
    public interactable = true;
    public clickEvents: EventHandler[] = [];
    public static Transition = { NONE: 0, COLOR: 1, SPRITE: 2, SCALE: 3 };
}
export class Toggle extends Component {
    public isChecked = false;
    public checkEvents: EventHandler[] = [];
}
export class Slider extends Component {
    public progress = 0;
    public slideEvents: EventHandler[] = [];
}
export class EditBox extends Component {
    public string = "";
    public placeholder = "";
}
export class ScrollView extends Component {
    public vertical = true;
    public horizontal = false;
    public scrollOffset = new Vec2();
    public scrollToTop(_time?: number, _attenuated?: boolean): void {}
    public scrollToBottom(_time?: number, _attenuated?: boolean): void {}
    public scrollToLeft(_time?: number, _attenuated?: boolean): void {}
    public scrollToRight(_time?: number, _attenuated?: boolean): void {}
    public scrollToOffset(_offset: Vec2, _time?: number, _attenuated?: boolean): void {}
    public stopScroll(): void {}
}
export class Layout extends Component {
    public updateLayout(): void {}
}

export enum KeyCode {
    NONE = 0,
    ESCAPE = 27,
    SPACE = 32,
    ENTER = 13,
}

export class Input extends EventTarget {}
export const input = new Input();

export class Layers {
    public static readonly NONE = 0;
    public static readonly IGNORE_RAYCAST = 1;
    public static readonly GIZMOS = 2;
    public static readonly EDITOR = 4;
    public static readonly UI_3D = 8;
    public static readonly SCENE_GIZMO = 16;
    public static readonly UI_2D = 32;
    public static readonly PROFILER = 64;
    public static readonly DEFAULT = 1073741824;
    public static readonly ALL = 4294967295;
    public static Enum: Record<string, number> = {};
}

export function ccclass(_name?: string): ClassDecorator {
    return () => {};
}
export function property(..._args: unknown[]): PropertyDecorator {
    return () => {};
}
