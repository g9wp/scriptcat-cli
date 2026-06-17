import { resolve as resovePath, toFileUrl } from "@std/path";
import { walk } from "@std/fs";

export type Action = Hello | OnChange;

export interface Hello {
  action: "hello";
}

export interface OnChange {
  action: "onchange";
  data: {
    uri: string;
    script: string;
  };
}
interface ClientInfo {
  isAlive: boolean;
  heartbeatTimeoutId?: ReturnType<typeof setTimeout>;
}

export class ScriptCat {
  port = 8642;
  // 心跳配置
  heartbeat_intereval = 30000; // 每 30 秒发送一次 hello 心跳
  // heartbeat_timeout = 10000; // 发送 hello 后，期待 10 秒内收到客户端的回应

  constructor(options?: {
    port?: number;
    heartbeat?: number;
    debounce?: number;
  }) {
    if (options?.port) this.port = options.port;
    if (options?.heartbeat) this.heartbeat_intereval = options.heartbeat;
    if (options?.debounce) this.debounce_delay = options.debounce;
    this.serve();
  }

  clients = new Map<WebSocket, ClientInfo>();

  _serve!: ReturnType<typeof Deno.serve>;

  serve() {
    if (this._serve) return this._serve;
    // 2. 启动 WebSocket 服务
    this._serve = Deno.serve({ port: this.port }, (req) => {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("Not a websocket request", { status: 400 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);

      let heartbeatIntervalId: ReturnType<typeof setInterval>;

      socket.onopen = () => {
        this.clients.set(socket, { isAlive: true });
        console.log(`[WS] 客户端已连接。当前连接数: ${this.clients.size}`);

        // 发送首次连接的 hello（同时也开启了第一次心跳）
        socket.send(JSON.stringify({ action: "hello" } as Hello));

        // 开启心跳定时器
        heartbeatIntervalId = setInterval(() => {
          const clientInfo = this.clients.get(socket);
          if (!clientInfo) return;

          // 如果上一次发完 hello 后，isAlive 还是 false，说明客户端超时没理我们
          if (!clientInfo.isAlive) {
            console.log("[WS] 客户端心跳超时，断开连接。");
            socket.close();
            return;
          }

          // 准备发起新一轮心跳探测
          // clientInfo.isAlive = false;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: "hello" } as Hello));
          }

          // // 设置超时断开倒计时
          // clientInfo.heartbeatTimeoutId = setTimeout(() => {
          //   if (!clientInfo.isAlive && socket.readyState === WebSocket.OPEN) {
          //     console.log("[WS] 规定时间内未收到客户端心跳回应，强行断开。");
          //     socket.close();
          //   }
          // }, HEARTBEAT_TIMEOUT);
        }, this.heartbeat_intereval);
      };

      socket.onmessage = (e) => {
        try {
          console.log("onmessage", e.data);
          const data = JSON.parse(e.data) as Action;

          // 客户端发回 { action: "hello" } 证明自己还活着
          if (data.action === "hello") {
            const clientInfo = this.clients.get(socket);
            if (clientInfo) {
              clientInfo.isAlive = true;
              if (clientInfo.heartbeatTimeoutId) {
                clearTimeout(clientInfo.heartbeatTimeoutId);
              }
            }
          }
        } catch (_err) {
          // 忽略无法解析的消息
        }
      };

      const cleanup = () => {
        const clientInfo = this.clients.get(socket);
        if (clientInfo?.heartbeatTimeoutId) {
          clearTimeout(clientInfo.heartbeatTimeoutId);
        }
        clearInterval(heartbeatIntervalId);
        this.clients.delete(socket);
        console.log(`[WS] 客户端已断开。当前连接数: ${this.clients.size}`);
      };

      socket.onclose = cleanup;
      socket.onerror = cleanup;

      return response;
    });
    console.log(`WebSocket 服务端已启动，端口: ${this.port}`);
    return this._serve;
  }

  // 3. 文件监听与防抖逻辑
  debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  debounce_delay = 150;

  handleFileChangeDebounced(path: string) {
    if (this.debounceTimers.has(path)) {
      clearTimeout(this.debounceTimers.get(path));
    }

    const timerId = setTimeout(async () => {
      this.debounceTimers.delete(path);
      try {
        const content = await Deno.readTextFile(path);
        console.log(`[Watcher] 文件稳定变更，发送内容: ${path}`);

        const onChangeMessage: OnChange = {
          action: "onchange",
          data: { uri: toFileUrl(path).toString(), script: content },
        };

        const messageStr = JSON.stringify(onChangeMessage);
        for (const [client] of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            console.log("[Watcher] [WS] 发送", client.url, path);
            client.send(messageStr);
          }
        }
      } catch (err) {
        console.error(`[Watcher] 读取文件失败: ${path}`, err);
      }
    }, this.debounce_delay);

    this.debounceTimers.set(path, timerId);
  }

  async watchFiles(watch_dir: string | string[], allowdd_exts: string[]) {
    console.log(`[Watcher] 正在监听文件夹: ${watch_dir}`);
    const watcher = Deno.watchFs(watch_dir, { recursive: true });
    for await (const event of watcher) {
      // console.log(event.kind, event.paths);
      if (this.clients.size == 0) continue;
      if (event.kind === "create" || event.kind === "modify" || event.kind === "rename") {
        for (const path of event.paths) {
          if (!allowdd_exts.find((ext) => path.endsWith(ext))) {
            continue;
          }
          this.handleFileChangeDebounced(path);
        }
      }
    }
  }
}

export class Cli {
  dir = ".";
  ext = ".user.js";

  async watch() {
    const sc = this._sc;
    await sc.watchFiles(this.dir, [this.ext]);
    await sc.serve().shutdown();
  }

  port = 8642;
  // 心跳配置
  heartbeat = 30000; // 每 30 秒发送一次 hello 心跳
  debounce = 150;

  get _sc() {
    return new ScriptCat({
      port: this.port,
      heartbeat: this.heartbeat,
      debounce: this.debounce,
    });
  }

  async send(...userjs: string[]) {
    if (userjs.length == 0) {
      userjs = (await Array.fromAsync(walk(this.dir, { exts: [this.ext] })))
        .map((f) => f.path);
      if (userjs.length == 0) {
        console.warn("not found any:", this.ext);
        return;
      }
    }

    const sc = this._sc;
    const s = sc.serve();
    let sended = false;
    while (!sended) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const [client] of sc.clients) {
        if (client.readyState === WebSocket.OPEN) {
          for (const path of userjs) {
            console.log("[WS] 发送", client.url, path);
            const onChangeMessage: OnChange = {
              action: "onchange",
              data: {
                uri: toFileUrl(resovePath(path)).toString(),
                script: await Deno.readTextFile(path),
              },
            };

            client.send(JSON.stringify(onChangeMessage));
            sended = true;
          }
        }
      }
    }
    for (const [client] of sc.clients) {
      client.close();
    }
    await s.shutdown();
  }

  w: boolean = true;
  main(...userjs: string[]) {
    if (this.w) return this.watch();
    return this.send(...userjs);
  }
}

import { cliteRun } from "@g9wp/clite";

if (import.meta.main) {
  await cliteRun(Cli);
}
