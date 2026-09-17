// import { parentPort } from "node:worker_threads";
// parentPort!.on("message", (funcInMultiThread: any) => {
//     console.error(`funcInMultiThread: ${funcInMultiThread}`);
//     let r = funcInMultiThread();
//     if (r instanceof Promise<void>)
//         r.then((v) => {
//             parentPort!.postMessage(v);
//         });
//     else parentPort!.postMessage(r);
// });
