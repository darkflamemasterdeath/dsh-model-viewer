# dsh-model-viewer

DeepSeek Harness (`dsh`) 的 3D 模型预览插件。

让助手在对话里直接预览 3D 模型文件（STEP / glTF / OBJ / STL / PLY / FBX），并在侧边栏提供一个独立的模型查看器面板。模型解析与渲染在浏览器端用 [three.js](https://threejs.org/) 完成；STEP 走 OCCT（`occt-import-js` WASM）在 Web Worker 里三角化，其余格式的解析也在 Web Worker 中进行，大文件不阻塞页面。

## 功能

- **`preview_step` 工具**：助手在回复里调用，即可在本轮回复下方渲染一个模型。`path` 可以填文件说明里的只读副本路径，或用户在对话里写出的磁盘路径；要看多个文件就调用多次。
- **侧边栏「模型预览」面板**：本地选文件，直接在面板里旋转查看。
- **回复尾部预览卡片**：出现在请求了预览的那条助手回复下方。
- **健壮的查看器**：自适应相机裁剪面（按模型尺寸缩放，避免大模型被远平面裁掉、小模型没入近平面）、轨道控制器、渐变天空 + 血色太阳、地面网格、雾效、渲染器复用池。
- **模型缓存**：按文件内容哈希（SHA-256）作键，LRU 淘汰；只有超过阈值的大文件才占用缓存槽，小文件每次廉价重建。同一内容只解析一次，多次显示共享只读几何。
- **持久化**：设置与预览记录写入 `~/.dsh/step-viewer/`，重启后通过回放会话日志恢复预览。
- **静态资源缓存**：OCCT 的 7MB WASM 与加载动画走插件自己的静态路由，用 ETag / 304 缓存，内容不变不重复下载。

## 安装

`dsh` 通过**插件配置（profile）**加载插件：一个 profile 是一组按序叠加的插件 bundle 补丁层，存放在 `$DSH_HOME/profiles` 下。把插件装进某个 profile 用 `dsh plugin` 子命令（它把参数原样转发给该 profile 目录里的 pnpm）：

```sh
dsh plugin --profile web add <package>
```

`<package>` 可以是 npm 包名、Git 仓库或本地路径：

```sh
# 从 npm（包已发布）
dsh plugin --profile web add dsh-model-viewer

# 从 Git 仓库
dsh plugin --profile web add github:<owner>/<repo>

# 从本地源码目录（先在该目录 pnpm build 出 lib/）
dsh plugin --profile web add /path/to/dsh-model-viewer
```

安装时，插件包 `dsh.bundle.patch` 指向的 [cordis.patch.yml](cordis.patch.yml) 会把插件（`id: dsh-model-viewer`）插入该 profile 的配置树；pnpm 装包时触发 `prepare` 脚本（即 `tsdown`）编译出 `lib/`。装完重启对应 profile 即可：

```sh
dsh web          # 本插件是 Web 客户端 UI 插件，装到 web profile 后这样启动
```

管理已装插件（同样转发给 pnpm）：

```sh
dsh plugin --profile web remove dsh-model-viewer   # 卸载
dsh plugin --profile web why dsh-model-viewer       # 查看依赖；list / why 等 pnpm 子命令都可用
```

前置条件：Node.js ≥ 24.9，且已安装 `dsh`（`npx @deepseek-ai/dsh`，或在 deepseek-harness 仓库里用 `pnpm dsh`）。

## 支持格式

| 格式 | 扩展名 | 解析方式 |
| --- | --- | --- |
| STEP | `.stp` `.step` | OCCT 三角化（Web Worker） |
| glTF | `.glb` `.gltf` | `GLTFLoader`（Web Worker） |
| Wavefront | `.obj` | `OBJLoader`（Web Worker） |
| STL | `.stl` | `STLLoader`（Web Worker） |
| PLY | `.ply` | `PLYLoader`（Web Worker） |
| FBX | `.fbx` | `FBXLoader`（Web Worker） |

格式判定只看扩展名（见 [shared/formats.ts](shared/formats.ts)）。

## 架构

插件有三个构建面：宿主进程、浏览器客户端、以及非 STEP 格式的解析 worker：

| 面 | 入口 | 产物 | 运行环境 | 职责 |
| --- | --- | --- | --- | --- |
| 宿主（host） | [service/index.ts](service/index.ts) | `lib/index.js`（Node ESM） | Node 宿主进程 | 注册 `preview_step` 工具与 HTTP 路由；跟踪上传与每轮预览；读写 `~/.dsh/step-viewer/` |
| 客户端（client） | [client/index.tsx](client/index.tsx) | `lib/client.js`（浏览器 CJS） | 浏览器（ModuleLoader factory） | 注册 UI 插槽（侧边栏图标、主查看器、回复尾预览）；three.js 渲染 |
| 解析 worker | [client/viewer/scene-worker.ts](client/viewer/scene-worker.ts) | `lib/scene-worker.js`（浏览器 ESM） | Web Worker | 非 STEP 格式解析（three.js loaders），只回传纯数据 |

```
dsh-model-viewer/
├── service/            # 宿主端（Node）
│   ├── index.ts        #   插件入口：注册 preview_step 工具 + 路由
│   ├── define-tool.ts  #   本地 defineTool 实现（宿主包仅作类型导入，零运行时依赖）
│   ├── files.ts        #   上传/磁盘文件查找，把 path 解析成可预览文件
│   ├── preview.ts      #   每轮预览记录、会话日志回放恢复
│   ├── routes.ts       #   /api/step-viewer/* 路由 + OCCT 静态资源
│   ├── config.ts       #   ~/.dsh/step-viewer/config.json 读写
│   └── types.ts
├── client/             # 客户端（浏览器，React + three.js）
│   ├── index.tsx       #   插件入口：注册 UI 插槽
│   ├── api.ts          #   访问 /api/step-viewer/*
│   ├── Icon.tsx / TurnPreview.tsx
│   └── viewer/         #   查看器核心
│       ├── Viewer.tsx        # 场景/相机/光照/渲染循环
│       ├── load-model.ts     # 解析 + 内容哈希缓存（LRU）
│       ├── parse.ts          # OCCT / scene worker 调用管线
│       ├── scene-worker.ts   #   非 STEP 格式解析 worker 入口
│       ├── scene-serial.ts   #   worker ↔ 主线程场景序列化/重建
│       ├── build-mesh.ts     # StepMesh → three.js 网格
│       ├── renderer-pool.ts  # WebGL 渲染器复用池
│       └── ...
├── shared/             # 宿主/客户端共享
│   ├── formats.ts      #   支持的扩展名 + 判定函数
│   ├── config.ts       #   ViewerConfig 类型与默认值
│   └── debug.ts        #   开发期调试开关（按 NODE_ENV 门控）
├── occt/               # OCCT 解析器资产（打进包）
│   ├── occt-import-js.js
│   ├── occt-import-js.wasm   # ~7MB
│   └── worker.js
├── assets/             # 静态资源（加载动画等）
└── tsdown.config.ts    # 三个构建面的配置
```

## 构建

依赖 `pnpm`（本仓库为 `dsh` monorepo 的一部分）。

```sh
pnpm install      # 安装依赖（会触发 prepare 生产构建）
pnpm build        # 生产构建 → lib/
pnpm dev          # 监听模式，改动即重建
```

构建用 [tsdown](https://tsdown.dev/)，产物写入 `lib/`（已在 `.gitignore` 中忽略）：

- `lib/index.js` — Node ESM，零运行时 `@deepseek-ai/*` 依赖：`@deepseek-ai/*` 仅作类型导入，`defineTool` 由 [service/define-tool.ts](service/define-tool.ts) 本地实现，运行时能力经 `ctx` 由宿主注入。
- `lib/client.js` — 浏览器 CJS，打包 three.js 及其 loaders；`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 不打包（由 Web 客户端提供）。

三个构建面都把 `env.NODE_ENV` 烘焙进 `process.env.NODE_ENV`，供 [shared/debug.ts](shared/debug.ts) 门控开发期插桩。裸跑 `npx tsdown` 时回退为 `production`，否则浏览器产物会残留字面量 `process.env.NODE_ENV`（浏览器没有 `process`），加载即抛错。详见 [tsdown.config.ts](tsdown.config.ts) 顶部注释。

## 配置

持久化在 `~/.dsh/step-viewer/config.json`（首次启动写出默认值，可直接就地编辑）。查看器面板里的「缓存设置」也能改，保存后重启生效。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cacheCount` | `4` | 缓存的模型个数上限，超出按最久未使用淘汰 |
| `cacheMinSizeMB` | `25` | 只有超过该大小（MB）的文件才缓存，更小的每次重建 |
| `hiddenPreviews` | `[]` | 用户永久隐藏的预览，键为 `session:turn:index`；隐藏后不再列出，把键从配置里删掉即可恢复 |

预览记录另存于 `~/.dsh/step-viewer/previews.json`。

## HTTP 路由

宿主端通过页面连接注册下列路由（前缀 `/api/step-viewer/`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/occt.js` `/occt.wasm` `/worker.js` | OCCT 解析器资产，带 ETag / 304 |
| GET | `/loading.webp` | 加载动画（`assets/loading/loading.webp`），带 ETag / 304 |
| GET | `/preview` | 不带 `index` 列出某轮的预览；带 `index` 返回该文件字节 |
| GET / POST | `/config` | 读取 / 更新缓存设置 |
| POST | `/hide` | 永久隐藏某个预览 |

## 环境要求

- Node.js ≥ 24.9（随 `dsh` 宿主要求）
- 作为 `deepseek-harness` monorepo 的插件运行，依赖 Cordis 插件体系；`@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis` 仅作开发期类型依赖（devDependencies），不随本插件分发。
- 运行时依赖：`three`。`react` 由 Web 客户端提供；`@deepseek-ai/*` 不在运行时导入（见 [service/define-tool.ts](service/define-tool.ts)），宿主能力经 `ctx` 注入。
