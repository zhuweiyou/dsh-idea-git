# dsh-idea-git（IDEA Git）

IDEA 风格的 Git 工具窗口，作为 DeepSeek Harness（DSH）插件运行。使用 TS + React + TSX，
样式与交互参考 [OpenIDEA](https://github.com/l0ng-ai/openidea) 的 Git 工具窗口（`src/features/vcs`）。

## 入口

- **GIT 按钮**：会话输入框左侧工具行（“完全权限”右侧）。有 hover 高亮；面板打开时按钮保持常驻高亮。
  点击展开底部 Git 面板，再次点击收起。
- **底部面板**：可拖动上边缘改变高度；支持「最小化 / 最大化（全屏）/ 关闭」；双击标题栏切换最大化。

## 仓库定位

以当前会话打开的工作区作为 Git 仓库位置。若工作区只是某个仓库的**子目录**，插件用
`git rev-parse --show-toplevel` 向上找到仓库根，并展示**整个仓库**。

## 功能（进度）

- [x] 改动与提交：改动树（按目录分组、已暂存/未暂存）、整文件暂存/取消暂存/丢弃、提交信息框、
      Commit / Commit and Push、Amend。
- [x] 提交日志：提交图（lane 绘制）、分支面板（含远程）、文本过滤、提交详情（消息 + 改动文件）、
      滚动加载更多。
- [x] 控制台：git 命令与输出（成功/失败着色、清空、自动刷新）。
- [x] Diff 差异查看器：点击改动文件 / 提交详情里的文件，展开面板内差异（新增/删除/块高亮）。
- [x] 分支与远程：标题栏分支下拉切换/新建分支，Fetch / Pull / Push。
- [x] Stash：储藏列表、储藏当前改动、应用 / 弹出 / 删除。
- [x] Worktree：工作树列表、添加、删除。
- [x] Blame：在差异抽屉里对文件逐行归属。
- [x] AI 生成提交信息：提交框旁的 ✦ 按钮，按当前会话模型生成（无模型时提示）。
- [ ] 冲突解决、文件历史、设置页（后续打磨）

## 深浅主题

完整沿用 OpenIDEA 的设计 token（`Islands Dark` 默认 + `Islands Light`），作用域限定在面板内部；
面板 `data-theme` 由 DSH 主题的 `colorScheme` 决定，并随 `theme/change` 实时切换。

## 构建

```sh
pnpm install
pnpm build       # scripts/build.mjs：Host -> lib/index.js，Client -> dist/client.js
```

Host 产物 `lib/index.js` 与客户端产物 `dist/client.js`（`window.__ModuleLoader__` 形式）随包发布。
通过 DSH 插件管理安装本目录（链接安装）。

## 与现有插件

本插件与 `@happyqu/dsh-plugin-git` 并存（两个 Git 按钮都会出现）。确认新版稳定后可在插件管理中禁用旧插件。

## 许可

样式 token 与提交图算法参考 OpenIDEA（Apache-2.0）。图标为原创绘制。
