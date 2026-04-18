type Task = () => Promise<void>;

export class SerialTaskQueue {
  private readonly tasks: Task[] = [];
  private isRunning = false;

  enqueue(task: Task): void {
    this.tasks.push(task);
    if (!this.isRunning) {
      void this.runNext();
    }
  }

  size(): number {
    return this.tasks.length + (this.isRunning ? 1 : 0);
  }

  private async runNext(): Promise<void> {
    const next = this.tasks.shift();
    if (!next) {
      this.isRunning = false;
      return;
    }

    this.isRunning = true;
    try {
      await next();
    } catch {
      // Keep the queue moving even when a task fails.
    }

    await this.runNext();
  }
}
