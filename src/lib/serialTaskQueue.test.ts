import { describe, expect, test } from "vitest";
import { SerialTaskQueue } from "./serialTaskQueue";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

describe("SerialTaskQueue", () => {
  test("runs tasks in order even with async delays", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];

    queue.enqueue(async () => {
      events.push("a:start");
      await delay(20);
      events.push("a:end");
    });

    queue.enqueue(async () => {
      events.push("b:start");
      await delay(5);
      events.push("b:end");
    });

    await delay(60);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("continues after task failure", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];

    queue.enqueue(async () => {
      events.push("first");
      throw new Error("boom");
    });

    queue.enqueue(async () => {
      events.push("second");
    });

    await delay(20);
    expect(events).toEqual(["first", "second"]);
  });
});
