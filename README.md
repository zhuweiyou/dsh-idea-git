# dsh-idea-git（IDEA Git）

IDEA 风格的 Git 工具窗口，作为 DeepSeek Harness（DSH）插件运行。

<img width="1275" height="1071" alt="image" src="https://github.com/user-attachments/assets/5e033765-dac9-4a1d-86a4-03af717d31ae" />

## 安装

### Desktop 版

在 DSH 桌面端的插件安装入口里直接填写插件名称 `dsh-idea-git` 即可。

### Web 版

```sh
dsh plugin --profile web add dsh-idea-git
```

## 开发

```sh
vp build          # Host + Client 构建
vp test           # Vitest（Host 集成测试）
vp check          # 格式 + lint + 类型检查
vp fmt . --write  # 按 2 空格 / 无分号 / 双引号 / printWidth 120 格式化
```

## 入口

- **GIT 按钮**：会话输入框左侧，hover 高亮、打开态与控件 hover 一致，点击开关面板。
- **底部面板**：停靠式布局（打开时把内容上推，不悬浮遮挡）；双击标题栏切换最大化；上边缘透明热区可调高度。
- 一级标签页：**Commit / 日志 / 控制台 / 工作树 / 子模块**；Commit 内含 **更改 / 储藏 / 货架** 内容页签（可选合并为「储藏与货架」）。
- 面板状态**按工作区隔离**：切换工作区各自保留开合、标签、提交信息与内容。

## 主要功能

### 改动与提交

- 变更列表分组：新建 / 重命名 / 备注 / 删除 / 设为活动；拖拽文件或文件夹归类；分组可折叠。
- 目录树 / 平铺切换；文件与分组的勾选（三态）。
- **Hunk 级暂存/部分提交**：Diff 中每个变更块可勾选，未勾选的块不进入提交；文件显示 `partial` 半选态。
- 回滚、Update、Amend、按变更列表单独提交。
- 提交信息：多行、历史复用、AI 生成；提交信息检查（主题长度、空行）。
- 提交选项：**作者**、**Signed-off-by**。
- 提交前警告：detached HEAD、合并/变基进行中、大文件、CRLF 等。

### 提交日志

- 提交图（分支连线）、提交列表、作者/日期列。
- 分支树：本地/远程分组、搜索、收藏（置顶 + 星标）。
- 标签区（支持搜索、强制覆盖、推送）。
- 过滤条：文本/哈希、正则、大小写、Branch、User、Date、Paths；全部/当前分支；日期/拓扑排序。
- 视图选项：First parent only、No merges（可持久化为默认）。
- 多选提交（Shift 范围 / Ctrl 切换）查看范围改动。
- 提交右键：检出任一版本、比较（当前/工作区/任意修订）、提交列表对比、重置、还原、撤销、Squash/Fixup、编辑提交信息、交互式 Rebase、Cherry-Pick、补丁、新建分支/标签、复制、父/子提交、浏览器打开等。

### 比较与冲突

- **任意版本比较**：搜索式选择分支/标签/修订；Compare 视图支持文件列表 + 文本/图片/二进制差异。
- **Compare Branches**：双栏显示两个版本各自独有的提交。
- **Incoming / Outgoing**：相对上游的待拉取/待推送提交列表。
- **IDEA 式冲突弹窗**：冲突文件列表，逐文件采用我方/对方或打开三栏合并编辑器（Base / Ours / Theirs，支持逐块选择与可编辑结果）。
- **取消操作**：合并/变基/拣选中可一键 Abort。

### Diff

- 双栏 / 统一视图；空白策略（不忽略 / 忽略行尾 / 忽略空白 / 忽略空白与空行）。
- 按词 / 按行 / 不高亮；折叠未改动；上一处/下一处改动；行号。
- **语法高亮**、**查找（回车跳转）**、**自动换行**。
- **图片对比**（含 Git LFS 指针自动 smudge 还原）、二进制提示。
- **Hunk 操作**：暂存此块 / 取消暂存此块 / **回滚此块**。
- 工作区侧文件可在 Diff 内**编辑并保存 / 保存并暂存**；Blame 与文件历史。

### 分支 / 远程 / 储藏 / 工作树 / 子模块

- 分支：检出、新建、重命名、删除（含强制）、合并、Rebase、与当前/工作区比较。
- 远程：Fetch / Pull / Push；Pull into 当前分支（merge/rebase）；远端新增/改地址/删除。
- Stash 与 Shelf（命名货架）：列表、储藏、应用/弹出、删除；Stash 支持差异预览。
- 工作树：添加、删除、锁定/解锁、移动、修复关联、清理失效。
- 子模块：状态列表、单个/全部更新。

### Git LFS

- 指针识别与 `git lfs smudge` 对比/下载还原。
- `lfs track` / `untrack`、历史 `migrate`、文件锁 `lock` / `unlock` / `locks`。

### 仓库与设置

- 非 Git 仓库时提供：**初始化仓库（git init）**、**克隆仓库（URL + 目标目录）**、重试。
- 设置页：
  - Git 可执行文件路径；
  - 自动 Fetch（面板打开时每 2 分钟）；
  - Git Log 默认选项（First parent / No merges）；
  - 合并/分开显示 Stash 与 Shelf；
  - 主题：跟随 DSH / 浅色 / 深色；
  - 语言：跟随 DSH / 简体中文 / English。

### 体验

- 图标按钮即时 tooltip；统一使用 DSH 原生 `Modal` 确认与输入弹窗；禁用态配色稳定；操作结果 toast；错误横幅；面板级错误边界。

## 主题与语言

- [x] 主题默认跟随 DSH `colorScheme`，可单独覆盖为浅色/深色
- [x] 文案「英文源 + 中文词典」默认跟随 DSH `locale`，可单独覆盖为中/英
