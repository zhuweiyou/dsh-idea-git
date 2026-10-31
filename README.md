# dsh-idea-git（IDEA Git）

IDEA 风格的 Git 工具窗口，作为 DeepSeek Harness（DSH）插件运行。

## 入口
- **GIT 按钮**：会话输入框左侧（“完全权限”右侧），hover 高亮、打开态常驻高亮，点击 toggle。
- **底部面板**：拖动上边缘调高、最小化 / 最大化（全屏）/ 关闭；双击标题栏切换最大化。
- 标签页：**Git（改动）/ Log / Console / Worktrees / Stash**。

## 仓库定位
以当前会话工作区为位置；若工作区是某仓库的子目录，用 `git rev-parse --show-toplevel`
向上找到仓库根并展示整仓。

## 功能
- **改动与提交**：目录分组/扁平切换、包含勾选框（文件与分组三态）、整文件暂存/取消/丢弃、
  回滚全部、Update、提交信息（多行、历史复用、AI 生成）、Commit / Commit and Push、Amend；
  只提交勾选文件。
- **提交日志**：提交图（贝塞尔连线）、分支树（Local/Remote 文件夹 + 搜索）、Tags、
  过滤条（文本/哈希、正则 `.*`、大小写 `Cc`、Branch、User、Date、Paths）、全部/当前分支、
  日期/拓扑排序、多选（Shift 范围 / Ctrl 切换）、详情按目录分组的文件树 + 提交信息。
- **控制台**：git 命令与输出着色、清空、自动刷新。
- **Diff**：默认**双栏对比**，可切统一视图；空白策略（不忽略/忽略行尾/忽略空白/忽略空白与空行）、
  高亮（按词/按行/不高亮）、折叠未改动、上下切换改动、行号；**图片双栏对比**；Blame、文件历史。
- **分支与远程**：分支检出/新建/重命名/删除/合并/Rebase、Compare with Current/Show History；
  Tags 检出/新建/删除/历史；Fetch/Pull/Push；远端新增/改 URL/删除。
- **Stash**：列表/储藏/应用/弹出/删除。
- **Worktree**：列表/添加/删除/锁定/解锁/清理失效。
- **冲突解决**：Ours/Theirs 双栏对比 + 采用我方/采用对方/标记已解决。
- **提交右键**：复制修订号/信息、创建补丁、检出、与本地比较、软/混合/硬重置到此、还原、
  撤销提交、Squash into Parent、Drop Commit、编辑提交信息、新建分支/标签、Cherry-Pick、
  转到父/子提交、在浏览器打开。
- **Git LFS**：识别指针并 `git lfs smudge` 还原后再对比；设置页显示 LFS 版本与跟踪文件。
- **设置页**：可编辑 Git 可执行文件路径（持久化）、Git/LFS 版本、仓库/主题/语言说明。

## 主题与语言
`data-theme` 跟随 DSH
`colorScheme` 并订阅 `theme/change`；文案「英文源 + 中文词典」跟随 DSH locale。

## 构建与安装
```sh
pnpm install
pnpm build        # Host -> lib/index.js，Client -> dist/client.js（__ModuleLoader__）
```
通过 DSH 插件管理以本地目录安装（`file:` 规格，避免误从 npm 拉取）。
