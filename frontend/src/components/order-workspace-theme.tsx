"use client";

import { createTheme, ThemeProvider } from "flowbite-react";
import type { ReactNode } from "react";

const inputColor = "border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-300 dark:bg-white dark:text-gray-900 dark:placeholder-gray-500 dark:focus:border-blue-700 dark:focus:ring-blue-700";
const theme = createTheme({
  modal: {
    content: { inner: "relative flex max-h-[90dvh] flex-col rounded-lg border border-gray-200 bg-white text-gray-900 shadow-xl dark:border-gray-200 dark:bg-white dark:text-gray-900" },
    body: { base: "flex-1 overflow-auto bg-white p-6 text-gray-900 dark:bg-white dark:text-gray-900" },
    header: {
      base: "flex items-start justify-between rounded-t-lg border-b border-gray-200 bg-white p-5 dark:border-gray-200 dark:bg-white",
      title: "text-xl font-semibold text-gray-900 dark:text-gray-900",
      close: { base: "ms-auto inline-flex items-center rounded-lg bg-transparent p-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-100 dark:hover:text-gray-900" },
    },
  },
  button: { color: {
    default: "bg-blue-700 text-white hover:bg-blue-800 focus:ring-blue-300 dark:bg-blue-700 dark:text-white dark:hover:bg-blue-800 dark:focus:ring-blue-300",
    light: "border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 focus:ring-gray-200 dark:border-gray-300 dark:bg-gray-50 dark:text-gray-700 dark:hover:bg-gray-100 dark:focus:ring-gray-200",
  } },
  label: { root: { colors: { default: "text-gray-900 dark:text-gray-900" } } },
  textInput: { field: { input: { colors: { gray: inputColor } } } },
  select: { field: { select: { colors: { gray: inputColor } } } },
  textarea: { colors: { gray: inputColor } },
  table: {
    root: { base: "w-full text-left text-sm text-gray-700 dark:text-gray-700", shadow: "absolute left-0 top-0 -z-10 h-full w-full rounded-lg bg-white dark:bg-white" },
    head: { base: "group/head text-xs uppercase text-gray-600 dark:text-gray-600", cell: { base: "bg-gray-50 px-6 py-3 dark:bg-gray-50" } },
  },
});

export function OrderWorkspaceTheme({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
