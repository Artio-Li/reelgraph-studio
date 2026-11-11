# ReelGraph Studio

ReelGraph Studio 是一个可自托管的 AI 视频创作工作台：把 Gemini 提示词与人物图、全局真实拍摄模式、Muse 账号池、快捷生成、任务管理和节点式无限画布整合到同一个 Web 应用中。

本项目最初借鉴并基于 [LIUFelix2004/museAPI-video](https://github.com/LIUFelix2004/museAPI-video) 的平台代码继续开发，在此基础上补充了账号批量登录导入、账号级代理、可持久化无限画布、节点执行闭环、Docker Compose 部署和 ReelGraph Studio 品牌整理。

> 当前版本：**Alpha / 阶段 2（可用闭环）**。核心链路已经可运行，但仍不建议在没有额外安全加固的情况下直接作为多租户公网服务。

## 能做什么

- **快捷创作**：提示词、参考图、模型、时长、画幅与生成队列统一管理。
- **Gemini 创作**：关键词扩写视频提示词，支持多张人物参考图生成统一角色形象。
- **全局真实拍摄模式**：管理员一次开启后，提示词、图片、视频、无限画布和自动队列都会由服务端统一附加去 AI 感的物理拍摄约束。
- **无限画布**：文本、图片、Gemini 提示词、Gemini 人物图、角色、视频、分镜节点；连线、循环检测、自动保存、节点执行、状态轮询、结果回填与缓存复用。
- **Muse 账号池**：Cookie、一键绑定、邮箱验证码、邮箱 + 密码 + 2FA 批量导入。
- **账号级代理**：为不同账号配置独立的 HTTP / SOCKS5 出口。
- **用户与权限**：管理员和普通用户登录；管理员维护平台配置与账号池。
- **作品与任务**：生成任务、媒体结果、额度和失败状态集中查看。

底层生成能力由仓库内的 [muse2api](https://github.com/czg86389-hub/muse2api) 提供，ReelGraph Studio 负责产品界面、用户系统、账号管理和工作流编排。

```text
浏览器（React）
       │
       ▼
ReelGraph Server（Node.js + SQLite）
       ├────────► Gemini 官方 API（提示词 / 人物图）
       │
       ▼
muse2api（FastAPI + Chromium）──► muse.ai（视频）
```

## 快速开始：Docker Compose

### 1. 准备配置

```bash
git clone https://github.com/Artio-Li/reelgraph-studio.git
cd reelgraph-studio
cp .env.docker.example .env
```

编辑 `.env`，至少替换以下三个值：

- `MUSE2API_KEY`
- `JWT_SECRET`
- `ADMIN_PASSWORD`

### 2. 启动

```bash
docker compose up -d --build
```

访问：<http://127.0.0.1:8787>

```bash
docker compose logs -f reelgraph
docker compose down
```

运行数据分别保存在 Docker 卷 `reelgraph_data` 与 `muse2api_data` 中，重建容器不会丢失账号和任务。

### 3. 首次登录后的配置顺序

1. 使用 `.env` 中的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 登录。
2. 在“账号池”导入至少一个你有权使用的 Muse 账号；如有需要，为账号配置独立代理。
3. 在“管理员 → 设置”中按需配置 Gemini 官方 API Key 和默认模型。
4. 检查全局“真实拍摄 / 去 AI 感”开关；新部署默认开启。
5. 从“快捷创作”“Gemini 创作台”或“无限画布”开始生成。

## 本地开发

要求：

- Node.js 22+
- Python 3.11+
- Chrome / Chromium

### 平台后端

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### Web 前端

```bash
cd web
npm install
npm run dev
```

### 上游引擎

```bash
cd upstream/muse2api
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 18610
```

Windows 也可以使用仓库根目录的 `start.ps1` / `stop.ps1`。

## 核心页面

| 路由 | 功能 |
|---|---|
| `/create` | 快捷创作、参考图、参数与生成队列 |
| `/gemini` | Gemini 提示词与人物图创作台 |
| `/canvas` | 节点式无限画布与工作流执行 |
| `/accounts` | 账号导入、额度、保活和代理配置 |
| `/admin` | 管理员配置（Gemini API Key、默认模型、全局真实拍摄模式等） |

## Gemini 官方 API

管理员登录后进入 `/admin` 的“设置”页：

1. 启用 Gemini。
2. 填写从 [Google AI Studio](https://ai.google.dev/aistudio) 创建的 API Key。
3. 保存并点击“测试连接并加载模型”。
4. 选择默认文本模型和默认图片模型。

API Key 使用服务端 JWT Secret 派生密钥进行 AES-256-GCM 加密后写入 SQLite；管理接口只返回“是否已配置”，不会把明文 Key 发给浏览器。`JWT_SECRET` 必须长期保持不变，否则需要重新保存 Gemini Key。

## 全局“真实拍摄 / 去 AI 感”模式

管理员进入“管理员 → 设置 → 全局生成风格”即可开启或关闭。新部署默认开启，配置写入 SQLite，重启和重建容器后仍然有效。

开启后，后端会统一补充现实拍摄约束，普通用户不需要在每次生成时重复粘贴：

- Gemini 视频提示词扩写
- Gemini 与 Muse 图片生成
- Muse 视频生成
- 无限画布的视频节点与 Gemini 节点
- 自动生成队列

约束重点包括真实光源、镜头透视、人体结构、皮肤与面料质感、动作惯性、连续视频的一致性，以及与现实原因对应的对焦、曝光和运动模糊。系统使用内部标记防止同一提示词被重复追加；开关状态也会进入画布输入哈希，因此切换模式后不会错误复用旧模式的节点缓存。

关闭后，服务端会把用户原始提示词直接交给生成 Provider。该功能属于提示词层增强，不是对生成结果的后期修复，最终真实性仍取决于所选模型、参考图质量和原始描述。

## 账号导入

支持四类流程：

1. 浏览器扩展一键读取当前 Muse 登录态。
2. 手动粘贴包含 `hatch_sess` 的 Cookie。
3. 邮箱 + 邮箱验证码登录。
4. 邮箱 + 密码 + 2FA 登录，支持形如 `邮箱----密码----2FA链接` 的批量文本。

账号、Cookie、密码、2FA 链接与生成媒体只应存在于本机运行数据目录中。它们已被 `.gitignore` 排除，**不要把运行目录或数据库提交到公开仓库**。

## 无限画布当前能力

- 多画布创建、重命名、删除与数据库持久化
- 文本、图片、Gemini 提示词、Gemini 人物图、角色、视频、分镜节点
- 拖拽、缩放、连线、多选、删除与视口保存
- 端口类型检查与循环依赖检测
- 参考素材上传
- 单节点执行、运行记录、异步状态轮询与错误回显
- 输入哈希缓存与强制重新生成
- 预估积分与结果节点回填

完整阶段说明见 [ROADMAP.md](./ROADMAP.md)。

## 目录结构

```text
reelgraph-studio/
├── compose.yaml                 Docker Compose 编排
├── Dockerfile                  平台 Web + Server 镜像
├── extension/                  Muse 账号绑定扩展
├── server/                     Node.js / Express / SQLite
├── web/                        React / Vite / XYFlow
├── upstream/muse2api/          Muse 浏览器自动化引擎
├── scripts/                    验收与维护脚本
└── ROADMAP.md                  阶段与后续计划
```

## 安全提示

- 公网部署前必须修改管理员密码、JWT 密钥和 Muse API Key。
- 建议在反向代理层启用 HTTPS、访问限速和请求体大小限制。
- 不要提交 `.env`、SQLite 数据库、Cookie、2FA 链接、生成媒体或浏览器 Profile。
- 邮箱自动登录和浏览器自动化可能受到上游页面变化、风控及服务条款影响，请仅操作你有权使用的账号。

## 测试

```bash
cd web && npm run build
node scripts/acceptance.mjs
node scripts/test-extension-logic.mjs
```

## 许可与致谢

- 感谢 [LIUFelix2004/museAPI-video](https://github.com/LIUFelix2004/museAPI-video) 提供本项目最初借鉴和继续开发的平台基础。
- 感谢 [czg86389-hub/muse2api](https://github.com/czg86389-hub/muse2api) 提供底层 Muse 浏览器自动化与生成能力。
- `upstream/muse2api/` 保留其原有 MIT License。
- 平台层目前尚未单独授予开源许可证；公开仓库用于查看、部署与协作。若要对外分发或商用，请先确认平台层许可。

本项目与 muse.ai 官方无隶属关系。
