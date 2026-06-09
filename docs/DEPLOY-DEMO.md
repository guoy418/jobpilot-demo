# 公网静态演示站（方案 1）

演示站只打包前端，使用 `src/mockData.ts` 里的示例数据，**不连接 API、不上传个人 SQLite**。

本地状态栏会显示 `[PUBLIC DEMO]`。

## 本地先验证

```bash
cd interview-tool-handoff-v0.7

# 构建演示包，并检查不会带上本地 API / SQLite / server/data
npm run demo:check

# 本地预览（默认 http://localhost:4173）
npm run preview:demo
```

开发时也可用演示模式（同样不走 API）：

```bash
npm run dev:demo
```

## 日常自用（不变）

```bash
npm run dev:local    # 同时启动本地 API + 前端，使用个人 SQLite
```

如果想分开看两个终端，也可以手动运行 `npm run api` 和 `npm run dev`。
个人库与公网演示**完全分离**；不要把 `jobpilot.local.sqlite` 部署到任何托管平台。

---

## 部署到公网（推荐：GitHub Pages）

任选一种静态托管即可，构建命令统一用 **`npm run demo:check`**，输出目录 **`dist`**。

### GitHub Pages（推荐）

适合「不买域名，只要一个公开演示链接」。

1. 在 GitHub 新建仓库，例如 `jobpilot-demo`。
2. 把本项目推到该仓库的 `main` 分支。
3. 打开仓库 Settings → Pages。
4. Source 选择 **GitHub Actions**。
5. 等 Actions 里的 **Deploy public demo** 跑绿。
6. 打开 `https://你的用户名.github.io/仓库名/`，例如 `https://yourname.github.io/jobpilot-demo/`。

项目已包含 `.github/workflows/deploy-demo.yml`。它会在每次 push 到 `main` 时自动：

- 设置 `VITE_PUBLIC_DEMO=true`
- 设置 GitHub Pages 子路径 `VITE_BASE_PATH=/<仓库名>/`
- 执行 `npm run demo:check`
- 发布 `dist`

如果你用的是用户站仓库（仓库名为 `你的用户名.github.io`），链接会是根路径 `https://你的用户名.github.io/`。这种情况下可继续使用当前配置；若发现页面资源 404，再把 workflow 里的 `VITE_BASE_PATH` 改成 `/`。

### Vercel

1. 把本仓库推到 GitHub。
2. [vercel.com](https://vercel.com) → Import 项目。
3. Root Directory：若 monorepo，填 `.../interview-tool-handoff-v0.7`。
4. Build Command：`npm run demo:check`
5. Output Directory：`dist`
6. 部署完成后在 Vercel 里绑定你买的域名（DNS 按提示加 CNAME）。

项目根目录已含 `vercel.json`，在仓库根即为本项目时可自动用演示构建。

### Netlify

1. Import from Git。
2. Build command：`npm run demo:check`
3. Publish directory：`dist`
4. Domain → 在 Netlify 里添加自定义域名。

已含 `netlify.toml` 可作参考。

### Cloudflare Pages

1. Connect Git → 选框架 Vite 或自定义。
2. Build command：`npm run demo:check`
3. Build output：`dist`
4. Custom domains 里绑定域名。

---

## 环境变量说明

| 变量 | 演示构建 | 本地开发 |
|------|----------|----------|
| `VITE_PUBLIC_DEMO` | `true`（`.env.demo` / `--mode demo`） | 不设 |
| `VITE_API_BASE_URL` | 不需要 | 可选，默认 `http://127.0.0.1:8787` |

托管平台**不要**设置 `VITE_API_BASE_URL`，除非你以后单独做「方案 2」演示 API。个人本地配置可以放 `.env` / `.env.local`，这些文件会被 git 忽略；公开 demo 只保留 `.env.demo`。
`npm run demo:check` 会拒绝带 `VITE_API_BASE_URL` 的 demo 构建，并扫描 `dist`，避免把本地 API、SQLite 或 `server/data` 信息打进公开包。

---

## 给别人的链接

部署完成后使用例如：

- `https://你的用户名.github.io/jobpilot-demo/`
- `https://jobpilot.你的域名.com`
- 或 Vercel 默认的 `https://xxx.vercel.app`

简历 / 作品集里直接贴该 URL。刷新页面会回到初始示例数据，属正常现象。

---

## 检查清单

- [ ] 用 `npm run demo:check` 构建，不是普通 `npm run build`
- [ ] 打开站点，状态为 `[PUBLIC DEMO]`
- [ ] 页面里是示例公司/岗位，没有你的真实 JD
- [ ] 托管环境变量里没有个人 API 地址
- [ ] GitHub Pages 的 Actions 已跑绿
