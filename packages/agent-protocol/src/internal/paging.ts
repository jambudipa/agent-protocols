/**
 * Paging of list responses, with the same arithmetic as the reference SDK.
 */
import type { Pagination, PaginationQuery } from '../Schemas.js';

/** The page that a list operation returns when the query names none. */
export const defaultCurrentPage = 1;

/** The page size of a list operation when the query names none. */
export const defaultPageSize = 10;

/** One page of `items`, and the paging metadata that describes it. */
export const page = <A>(
  items: ReadonlyArray<A>,
  query: PaginationQuery
): { readonly items: ReadonlyArray<A>; readonly pagination: Pagination } => {
  const currentPage = query.current_page ?? defaultCurrentPage;
  const pageSize = query.page_size ?? defaultPageSize;
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      total_items: items.length,
      total_pages: Math.ceil(items.length / pageSize),
      current_page: currentPage,
      page_size: pageSize,
    },
  };
};
