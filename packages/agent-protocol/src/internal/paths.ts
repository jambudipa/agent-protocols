/**
 * Pure path checks for artifact uploads. They run inside schema filters, before
 * any file system access, so they work on the raw strings from the request.
 */

const segments = (path: string): ReadonlyArray<string> => path.split(/[\\/]/)

/** True when `path` is relative and has no `..` segment. */
export const isWorkspaceRelative = (path: string): boolean =>
  !/^([\\/]|[A-Za-z]:)/.test(path) && !segments(path).includes("..")

/** The last segment of a client-supplied file name. */
export const fileNameOf = (name: string): string => segments(name).at(-1) ?? ""

/** True when the last segment of `name` can name a file. */
export const isUsableFileName = (name: string): boolean => {
  const last = fileNameOf(name)
  return last !== "" && last !== "." && last !== ".."
}
