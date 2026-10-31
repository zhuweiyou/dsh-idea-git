# dsh-idea-git（IDEA Git）

IDEA 风格的 Git 工具窗口，作为 DeepSeek Harness（DSH）插件运行。

## 安装

### Desktop 版

在 DSH 桌面端的插件安装入口里直接填写插件名称 `dsh-idea-git` 即可。

### Web 版

```sh
dsh plugin --profile web add dsh-idea-git
```

## 入口

- **GIT 按钮**：会话输入框左侧（“完全权限”右侧），hover 高亮、打开态与控件 hover 一致，点击 toggle。
- **底部面板**：IDEA 式停靠（打开时把内容上推，不悬浮遮挡）；双击标题栏切换最大化；上边缘透明热区可调高度。
- 标签页：**Commit / 日志 / 控制台 / 工作树 / 子模块 / 储藏 / 货架**。
- 面板状态**按工作区隔离**：切换工作区各自保留开合、标签、提交信息与内容；多仓库可在面板头切换目标仓库。

## 功能

- **改动与提交**：变更列表分组（可新建/重命名/备注/删除/设活动、拖拽文件或文件夹归类）、
  目录/扁平切换、勾选（文件与分组三态）、**Hunk 级暂存/部分提交**（`partial` 徽标）、
  回滚、Update、提交信息（历史复用、AI 生成）、作者/Sign-off、提交信息检查、
  Commit / Commit and Push、Amend、按列表单独提交。
- **提交日志**：提交图、分支树（本地/远程、收藏置顶+星标、搜索）、标签（可强制覆盖/推送）、
  过滤条（文本/哈希、正则、大小写、Branch、User、Date、Paths）、全部/当前分支、日期/拓扑排序、
  多选范围详情。
- **Diff**：双栏/统一、空白策略、按词/按行高亮、折叠、跳转改动、行号、**语法高亮**、
  **查找（回车上下）**、**自动换行**、图片对比、Blame、文件历史；工作区侧可直接编辑并保存/暂存。
- **合并编辑器**：冲突逐块 Ours/Theirs/Both；**查看 Base**；**结果可编辑**后应用。
- **交互式 Rebase**：可视化计划（pick/reword/squash/fixup/drop）、autosquash、拖拽重排、执行。
- **分支与远程**：检出/新建/重命名/删除/合并/Rebase、与当前比较、与工作区比较、Pull into（merge/rebase）。
- **Stash / Shelf（货架）**：列表、储藏、应用/弹出、删除；命名货架。
- **Worktree**：列表、添加、删除、锁定、移动、修复关联、清理失效。
- **子模块**：状态列表、单个/全部更新。
- **Git LFS**：指针识别与 smudge 对比、track/untrack、迁移（migrate）、文件锁 lock/unlock/list。
- **提交右键**：补丁、检出、比较、重置、还原、撤销、Squash/Fixup、编辑提交信息、
  交互式 Rebase、Cherry-Pick、新建分支/标签、父/子提交、浏览器打开等。
- **体验**：所有图标按钮即时 tooltip、右键菜单、命令按钮禁用态固定配色、错误横幅与操作 toast。

## 主题与语言

- [x] `data-theme` 跟随 DSH `colorScheme`，并订阅 `theme/change`
- [x] 文案「英文源 + 中文词典」跟随 DSH `locale`
