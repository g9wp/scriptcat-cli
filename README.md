# scriptcat-cli

[ScriptCat](https://github.com/scriptscat/scriptcat/) 用户脚本安装工具

# 主要功能

* 通过 websocket 发送用户脚本到 ScriptCat 
* 监听本地脚本文件，自动安装


# 用法

1. 配置 ScriptCat 开发连接

`ScriptCat 设置` -> `工具` -> `开发设置`
勾选`自动连接`或者每次安装时候手动`连接`

  - [x] **自动连接vscode服务**
  - **连接**

2. 运行 `send` 或 `watch` 子命令

  * `send`  单次安装
  * `watch` 监听文件/文件夹

```bash
deno run -A jsr:@g9wp/scriptcat-cli send userscript.user.js
deno run -A jsr:@g9wp/scriptcat-cli watch
```

# 关联

* **ScriptCat** https://github.com/scriptscat/scriptcat
* **VSCode 扩展** https://github.com/scriptscat/scriptcat-vscode
