// React automatic JSX runtime shim.
// The DSH Client module table provides `react` / `react-dom`, but not necessarily
// `react/jsx-runtime`, so the bundler maps that specifier here. Everything delegates
// to the host-provided React so hooks/context are shared with the application.
import React from "react"

export const Fragment = React.Fragment

function normalize(type: any, props: any, key: any) {
  if (key === undefined || key === null) return props ?? {}
  return { ...props, key }
}

export function jsx(type: any, props: any, key?: any) {
  return React.createElement(type, normalize(type, props, key))
}

export const jsxs = jsx
export const jsxDEV = jsx
