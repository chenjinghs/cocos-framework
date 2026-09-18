/**
 * 仓库自检用的最小 "cc" 模块声明。
 *
 * 仅覆盖框架源码引用到的 API 子集，宽松 unknown/泛型参数，不是完整引擎类型。
 * Cocos Creator 4.0 消费工程自带真实 cc 类型 —— 消费项目不要 include 本文件，
 * 若出现重复声明，把本文件从 typeRoots 链路移出、改由仓库自检 tsconfig 显式 files 引入。
 */

declare const jsb: {
    fileUtils: {
        isFileExist(path: string): boolean;
        isDirectoryExist(path: string): boolean;
        createDirectory(path: string): boolean;
        removeFile(path: string): boolean;
        removeDirectory(path: string): boolean;
        renameFile(oldPath: string, newPath: string): boolean;
        copyFile(srcPath: string, dstPath: string): boolean;
        writeStringToFile(data: string, path: string): boolean;
        writeDataToFile(data: Uint8Array, path: string): boolean;
        getStringFromFile(path: string): string;
        getDataFromFile(path: string): Uint8Array;
        listFiles(path: string): string[] | null;
        getWritablePath(): string;
    };
};

/** Web/小游戏全局最小声明（patcher-cocos 网络与跳转触点使用；消费项目以真实环境为准） */
declare class XMLHttpRequest {
    public status: number;
    public response: unknown;
    public responseType: string;
    public onprogress: ((event: { loaded: number; total: number }) => void) | null;
    public onload: (() => void) | null;
    public onerror: (() => void) | null;
    public open(method: string, url: string, async: boolean): void;
    public send(body?: unknown): void;
}
declare const navigator: { onLine: boolean; language: string };
declare const window: { open(url: string, target?: string): unknown };

declare module "cc" {
    // /////////////////////////////////////////////////////////
    // assets
    export class Asset {
        public name: string;
        public nativeUrl: string;
        public ref: number;
        public destroy(): boolean;
        public addRef(): Asset;
        public decRef(): Asset;
    }
    export class Prefab extends Asset {
        public data: unknown;
    }
    export class ImageAsset extends Asset {
        public width: number;
        public height: number;
    }
    export class Texture2D extends Asset {
        public image: ImageAsset | null;
        public width: number;
        public height: number;
    }
    export class SpriteFrame extends Asset {
        public texture: Texture2D | null;
    }
    export class JsonAsset extends Asset {
        public json: unknown;
    }
    export class TextAsset extends Asset {
        public text: string;
    }

    // /////////////////////////////////////////////////////////
    // events
    export class Event {
        public type: string;
        public target: unknown;
        public currentTarget: unknown;
    }
    export class EventTouch extends Event {
        public getLocation(): Vec2;
    }
    export class EventMouse extends Event {
        public getLocation(): Vec2;
    }
    type EventCallback = (...args: unknown[]) => void;
    export class EventTarget {
        public on(type: string, callback: EventCallback, target?: unknown, once?: boolean): void;
        public once(type: string, callback: EventCallback, target?: unknown): void;
        public off(type: string, callback?: EventCallback, target?: unknown): void;
        public emit(type: string, ...args: unknown[]): void;
        public targetOff(target: unknown): void;
        public hasEventListener(type: string, callback?: EventCallback, target?: unknown): boolean;
    }
    export class EventHandler {
        public target: Node | null;
        public component: string;
        public handler: string;
        public customEventData: string;
        public static emitEvents(events: EventHandler[] | undefined, ...args: unknown[]): void;
    }

    // /////////////////////////////////////////////////////////
    // math
    export class Color {
        public r: number;
        public g: number;
        public b: number;
        public a: number;
        public constructor(r?: number, g?: number, b?: number, a?: number);
    }
    export class Vec2 {
        public x: number;
        public y: number;
        public constructor(x?: number, y?: number);
    }
    export class Vec3 {
        public x: number;
        public y: number;
        public z: number;
        public constructor(x?: number, y?: number, z?: number);
    }
    export class Size {
        public width: number;
        public height: number;
        public constructor(width?: number, height?: number);
    }
    export class Rect {
        public x: number;
        public y: number;
        public width: number;
        public height: number;
        public constructor(x?: number, y?: number, width?: number, height?: number);
    }

    // /////////////////////////////////////////////////////////
    // scene graph
    type ComponentConstructor<T extends Component> = new (...args: never[]) => T;
    export class Component extends EventTarget {
        public node: Node;
        public name: string;
        public enabled: boolean;
        public enabledInHierarchy: boolean;
        public onLoad(): void;
        public start(): void;
        public update(dt: number): void;
        public onDestroy(): void;
        public onEnable(): void;
        public onDisable(): void;
        public getComponent<T extends Component>(type: ComponentConstructor<T>): T | null;
        public getComponents<T extends Component>(type: ComponentConstructor<T>): T[];
        public getComponentInChildren<T extends Component>(type: ComponentConstructor<T>): T | null;
        public getComponentsInChildren<T extends Component>(type: ComponentConstructor<T>): T[];
    }
    export class Node extends EventTarget {
        public name: string;
        public active: boolean;
        public activeInHierarchy: boolean;
        public parent: Node | null;
        public children: readonly Node[];
        public components: readonly Component[];
        public layer: number;
        public uuid: string;
        public constructor(name?: string);
        public addChild(child: Node): void;
        public removeChild(child: Node): void;
        public removeFromParent(): void;
        public removeAllChildren(): void;
        public getChildByName(name: string): Node | null;
        public getChildByPath(path: string): Node | null;
        public getChildByUuid(uuid: string): Node | null;
        public getComponent<T extends Component>(type: ComponentConstructor<T>): T | null;
        public getComponents<T extends Component>(type: ComponentConstructor<T>): T[];
        public getComponentInChildren<T extends Component>(type: ComponentConstructor<T>): T | null;
        public getComponentsInChildren<T extends Component>(type: ComponentConstructor<T>): T[];
        public addComponent<T extends Component>(type: ComponentConstructor<T>): T;
        public removeComponent(component: Component): void;
        public destroy(): boolean;
        public isChildOf(parent: Node): boolean;
        public setSiblingIndex(index: number): void;
        public getSiblingIndex(): number;
        public walk(callback: (node: Node) => void): void;
    }
    export class Scene extends Node {
        public isValid: boolean;
    }
    export function instantiate(original: Prefab | Node): Node;
    export function isValid(value: unknown, strictOrLoose?: boolean): boolean;

    // /////////////////////////////////////////////////////////
    // director & game
    export class Director extends EventTarget {
        public getScene(): Scene | null;
        public loadScene(sceneName: string, onLaunched?: (err?: Error | null) => void, onUnloaded?: (err?: Error | null) => void): boolean;
        public addPersistRootNode(node: Node): void;
        public removePersistRootNode(node: Node): void;
    }
    export const director: Director;
    export class Game extends EventTarget {}
    export const game: Game;

    /** 平台信息（最小子集） */
    export const sys: {
        os: string;
        osMainVersion: number;
        platform: number;
        language: string;
        isNative: boolean;
        isBrowser: boolean;
        /** 键值存储（PlayerPrefs 语义对应物），web/原生均可用 */
        localStorage: {
            getItem(key: string): string | null;
            setItem(key: string, value: string): void;
            removeItem(key: string): void;
        };
    };

    // /////////////////////////////////////////////////////////
    // asset manager
    export class Bundle extends Asset {
        public name: string;
        public load(path: string, onComplete?: (err: Error | null, asset: Asset) => void): void;
        public load(path: string, type: unknown, onComplete?: (err: Error | null, asset: Asset) => void): void;
        public loadDir(path: string, type: unknown, onComplete?: (err: Error | null, assets: Asset[]) => void): void;
    }
    export class AssetManager {
        public loadBundle(name: string, onComplete?: (err: Error | null, bundle: Bundle) => void): void;
        public loadBundle(name: string, options: Record<string, unknown>, onComplete?: (err: Error | null, bundle: Bundle) => void): void;
        public getBundle(name: string): Bundle | null;
        public removeBundle(bundle: Bundle): void;
        public releaseAsset(asset: Asset): void;
        public releaseAll(): void;
    }
    export const assetManager: AssetManager;
    export const resources: Bundle;

    // /////////////////////////////////////////////////////////
    // UI components
    export class UITransform extends Component {
        public width: number;
        public height: number;
        public contentSize: Size;
        public setContentSize(width: number | Size, height?: number): void;
    }
    export class Canvas extends Component {
        public cameraComponent: unknown;
    }
    export class Widget extends Component {
        public isAlignTop: boolean;
        public isAlignBottom: boolean;
        public isAlignLeft: boolean;
        public isAlignRight: boolean;
        public top: number;
        public bottom: number;
        public left: number;
        public right: number;
    }
    export class Label extends Component {
        public string: string;
        public color: Color;
        public fontSize: number;
        public lineHeight: number;
    }
    export class Sprite extends Component {
        public spriteFrame: SpriteFrame | null;
        public color: Color;
    }
    export class Button extends Component {
        public interactable: boolean;
        public clickEvents: EventHandler[];
        public static Transition: { NONE: number; COLOR: number; SPRITE: number; SCALE: number };
    }
    export class Toggle extends Component {
        public isChecked: boolean;
        public checkEvents: EventHandler[];
    }
    export class Slider extends Component {
        public progress: number;
        public slideEvents: EventHandler[];
    }
    export class EditBox extends Component {
        public string: string;
        public placeholder: string;
    }
    export class ScrollView extends Component {
        public vertical: boolean;
        public horizontal: boolean;
        public scrollOffset: Vec2;
        public scrollToTop(time?: number, attenuated?: boolean): void;
        public scrollToBottom(time?: number, attenuated?: boolean): void;
        public scrollToLeft(time?: number, attenuated?: boolean): void;
        public scrollToRight(time?: number, attenuated?: boolean): void;
        public scrollToOffset(offset: Vec2, time?: number, attenuated?: boolean): void;
        public stopScroll(): void;
    }
    export class Layout extends Component {
        public updateLayout(): void;
    }

    // /////////////////////////////////////////////////////////
    // input
    export enum KeyCode {
        NONE = 0,
        ESCAPE = 27,
        SPACE = 32,
        ENTER = 13,
    }
    export class Input extends EventTarget {}
    export const input: Input;

    // /////////////////////////////////////////////////////////
    // layers
    export class Layers {
        public static readonly NONE: number;
        public static readonly IGNORE_RAYCAST: number;
        public static readonly GIZMOS: number;
        public static readonly EDITOR: number;
        public static readonly UI_3D: number;
        public static readonly SCENE_GIZMO: number;
        public static readonly UI_2D: number;
        public static readonly PROFILER: number;
        public static readonly DEFAULT: number;
        public static readonly ALL: number;
        public static Enum: Record<string, number>;
    }

    // /////////////////////////////////////////////////////////
    // decorators
    export function ccclass(name?: string): ClassDecorator;
    export function property(...args: unknown[]): PropertyDecorator;
}
