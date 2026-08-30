import { spawn } from "node:child_process";

function timeoutError(label, timeoutMs, stderr) {
  const detail = stderr.trim() ? `\nPi stderr:\n${stderr.trim()}` : "";
  return new Error(`${label} timed out after ${timeoutMs}ms${detail}`);
}

export class PiRpcClient {
  constructor({ binary = "pi", args, cwd, timeoutMs = 300_000 }) {
    this.binary = binary;
    this.args = args;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.events = [];
    this.stderr = "";
    this.buffer = "";
    this.waiters = new Set();
    this.nextId = 1;
  }

  start() {
    this.child = spawn(this.binary, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => this.failWaiters(error));
    this.child.on("exit", (code, signal) => {
      if (code !== 0 && !this.closing) {
        this.failWaiters(new Error(`Pi RPC exited code=${code} signal=${signal}\n${this.stderr}`));
      }
    });
    return this;
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  onLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.failWaiters(new Error(`Invalid Pi RPC JSON line: ${line}\n${error}`));
      return;
    }
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(event, this.events.length - 1)) waiter.resolve(event);
    }
  }

  failWaiters(error) {
    for (const waiter of [...this.waiters]) waiter.reject(error);
  }

  waitFor(predicate, startIndex, label) {
    for (let index = startIndex; index < this.events.length; index += 1) {
      if (predicate(this.events[index], index)) return Promise.resolve(this.events[index]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(timeoutError(label, this.timeoutMs, this.stderr));
      }, this.timeoutMs);
      const waiter = {
        predicate,
        resolve: (event) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(event);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
  }

  async request(command) {
    if (!this.child?.stdin.writable) throw new Error("Pi RPC stdin is not writable");
    const id = `bench-${this.nextId++}`;
    const startIndex = this.events.length;
    const response = this.waitFor(
      (event) => event.type === "response" && event.id === id,
      startIndex,
      `${command.type} response`,
    );
    this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    const result = await response;
    if (!result.success) throw new Error(`${command.type} failed: ${JSON.stringify(result)}`);
    return result;
  }

  async prompt(message) {
    const startIndex = this.events.length;
    await this.request({ type: "prompt", message });
    await this.waitFor(
      (event) => event.type === "agent_end",
      startIndex,
      "agent_end",
    );
    return this.events.slice(startIndex);
  }

  async compact() {
    const startIndex = this.events.length;
    const response = await this.request({ type: "compact" });
    return { response, events: this.events.slice(startIndex) };
  }

  async state() {
    return (await this.request({ type: "get_state" })).data;
  }

  async disableAutoCompaction() {
    await this.request({ type: "set_auto_compaction", enabled: false });
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    this.closing = true;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}
