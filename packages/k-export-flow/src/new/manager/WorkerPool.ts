// import { AsyncResource } from "node:async_hooks";
// import { EventEmitter } from "node:events";
// import * as path from "path";
// import { Worker } from "node:worker_threads";

// const kTaskInfo = Symbol("kTaskInfo");
// const kWorkerFreedEvent = Symbol("kWorkerFreedEvent");

// class WorkerPoolTaskInfo extends AsyncResource {
//     private callback: any;
//     constructor(callback: any) {
//         super("WorkerPoolTaskInfo");
//         this.callback = callback;
//     }

//     done(err: any, result: any): any {
//         let r = this.runInAsyncScope(this.callback, null, err, result);
//         if (r instanceof Promise) r.then(this.emitDestroy.bind(this));
//         else this.emitDestroy(); // `TaskInfo`s are used only once.
//         return r;
//     }
// }

// export default class WorkerPool extends EventEmitter {
//     private numThreads = 0;
//     private workers: Array<any>;
//     private freeWorkers: Array<any>;
//     private tasks: Array<any>;

//     constructor(numThreads: number) {
//         super();
//         this.numThreads = numThreads;
//         this.workers = [];
//         this.freeWorkers = [];
//         this.tasks = [];

//         for (let i = 0; i < numThreads; i++) this.addNewWorker();

//         // Any time the kWorkerFreedEvent is emitted, dispatch
//         // the next task pending in the queue, if any.
//         this.on(kWorkerFreedEvent, () => {
//             if (this.tasks.length > 0) {
//                 const [funcInMultiThread, finishCallback] = this.tasks.shift();
//                 this.runTask(funcInMultiThread, finishCallback);
//             }
//         });
//     }

//     addNewWorker() {
//         const worker = new Worker(path.join(__dirname, "./WorkerTaskProcessor.js")) as any;
//         worker.on("message", (result: any) => {
//             // In case of success: Call the callback that was passed to `runTask`,
//             // remove the `TaskInfo` associated with the Worker, and mark it as free
//             // again.

//             let emit = () => {
//                 worker[kTaskInfo] = null;
//                 this.freeWorkers.push(worker);
//                 this.emit(kWorkerFreedEvent);
//             };

//             console.error(`11111111111`);
//             let r = (worker[kTaskInfo] as WorkerPoolTaskInfo).done(null, result);
//             if (r instanceof Promise) r.then(emit);
//             else emit();
//         });
//         worker.on("error", (err: any) => {
//             // In case of an uncaught exception: Call the callback that was passed to
//             // `runTask` with the error.
//             if (worker[kTaskInfo]) worker[kTaskInfo].done(err, null);
//             else this.emit("error", err);
//             // Remove the worker from the list and start a new Worker to replace the
//             // current one.
//             this.workers.splice(this.workers.indexOf(worker), 1);
//             this.addNewWorker();
//         });
//         this.workers.push(worker);
//         this.freeWorkers.push(worker);
//         this.emit(kWorkerFreedEvent);
//     }

//     runTask(funcInMultiThread: any, finishCallback: any) {
//         if (this.freeWorkers.length === 0) {
//             // No free threads, wait until a worker thread becomes free.
//             this.tasks.push({ funcInMultiThread, finishCallback });
//             return;
//         }

//         const worker = this.freeWorkers.pop();
//         worker[kTaskInfo] = new WorkerPoolTaskInfo(finishCallback);

//         // 这里推的东西必须是能够clone的，函数是不能clone的，所以这里推的只能是数据
//         worker.postMessage(funcInMultiThread);
//     }

//     close() {
//         for (const worker of this.workers) worker.terminate();
//     }
// }
