/** Maps the plugin's icon names onto OpenIDEA's own icon set. */
import React from "react"
import { Icon as IdeaIcon } from "./icons"

const MAP: Record<string, string> = {
  git: "toolwindow-git",
  refresh: "refresh",
  chevronDown: "chevron-down",
  chevronRight: "chevron-right",
  chevronLeft: "chevron-left",
  target: "locate",
  star: "star",
  starOutline: "star-outline",
  close: "close",
  check: "check",
  minus: "minus",
  plus: "plus",
  undo: "undo",
  commit: "commit",
  branch: "branch",
  file: "file",
  folder: "folder",
  maximize: "maximize",
  restore: "maximize",
  minimize: "minimize",
  eye: "eye",
  more: "more",
  warning: "warning",
  tag: "tag",
  download: "git-pull",
  upload: "git-push",
  cloud: "git-fetch",
  trash: "trash",
  stash: "stash",
  sparkle: "commit",
  history: "history",
  search: "search",
  lock: "lock",
  split: "split",
  list: "list",
  "collapse-all": "collapse-all",
  expandAll: "expand-all",
  "arrow-up": "arrow-up",
  "arrow-down": "arrow-down",
  edit: "edit",
  diff: "diff",
}

export function Icon(props: {
  name: string
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  const name = MAP[props.name] || props.name
  return <IdeaIcon name={name} size={props.size} className={props.className} style={props.style} />
}
