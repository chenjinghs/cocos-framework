/**
 * 各种interface
 */
// declare module "./Engine" {
//     export namespace Engine {
//         // timer相关
//         function setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
//         function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
//         function clearInterval(id: number | undefined): void;
//         function clearTimeout(id: number | undefined): void;
//     }
// }

/**
 * engine需实现
 */
export let canRunInThisThread = function (): boolean {
    return true;
};

export function setCanRunInThisThread(func: () => boolean) {
    canRunInThisThread = func;
}