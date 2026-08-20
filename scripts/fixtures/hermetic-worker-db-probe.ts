import { Worker, isMainThread, parentPort } from "node:worker_threads";

import { db, dbPath } from "../../server/db.ts";

if (!isMainThread) {
  parentPort?.postMessage(dbPath);
  db.close();
} else {
  const collect = () => new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url));
    worker.once("message", (value) => resolve(String(value)));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });

  const main = async () => {
    const paths = await Promise.all([collect(), collect()]);
    console.log(JSON.stringify({ processId: process.pid, paths }));
    db.close();
  };
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
